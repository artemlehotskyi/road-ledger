"""Tests for POST /analyze and street matching.

Run: cd api && .venv/bin/pytest -q
Nominatim is replaced with reverse-geocode answers recorded on 2026-10-28 (coordinates of the OSM ways).
RUN_LIVE=1 also checks the same points against the real Nominatim.
"""
import io
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import build_ledger
import main
from streets import keys_match, load_aliases, street_key

API_DIR = Path(__file__).resolve().parent
CONTRACTS = json.loads((API_DIR / "data" / "contracts.json").read_text(encoding="utf-8"))
CROPS = API_DIR.parent / "_import" / "photos" / "crops"

CITY = {"city": "Чернівці", "municipality": "Чернівецька міська громада"}
# (lat, lon) -> «road» from Nominatim reverse, recorded 2026-10-28
RECORDED = {
    (48.2982125, 25.9497665): "вулиця Українських Добровольців",  # way/155141393, old_name Білоруська
    (48.2594102, 25.9373330): "вулиця Сергія Скальда",            # way/133039544, old_name Комарова
    (48.3310918, 25.8872690): "Староленківська вулиця",           # way/245715371
    (48.3209475, 25.9904044): "вулиця Дениса Лукіяновича",        # way/155026643
}
BILORUSKA, SKALDA, STAROLENKIVSKA, LUKIIANOVYCHA = RECORDED


def fake_reverse(lat, lon):
    # EXIF coordinates come back rounded to 6 digits, so look up the nearest recorded point
    point = next(p for p in RECORDED if abs(p[0] - lat) < 1e-5 and abs(p[1] - lon) < 1e-5)
    return {"address": {"road": RECORDED[point], **CITY}}


def ids_with_key(key, scope="street"):
    return {c["contract_id"] for c in CONTRACTS if key in c["street_keys"] and c["scope"] == scope}


def jpeg(gps=None):
    img = Image.new("RGB", (320, 240), "gray")
    exif = Image.Exif()
    if gps:
        lat, lon = gps

        def dms(deg):
            d, rem = divmod(abs(deg) * 3600, 3600)
            m, s = divmod(rem, 60)
            return (float(d), float(m), round(s, 4))

        exif.get_ifd(0x8825).update({1: "N" if lat >= 0 else "S", 2: dms(lat),
                                     3: "E" if lon >= 0 else "W", 4: dms(lon)})
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:  # lifespan loads the model, contracts and aliases
        yield c


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(main, "reverse_geocode", fake_reverse)


def analyze(client, image, **form):
    r = client.post("/analyze", files={"image": ("photo.jpg", image, "image/jpeg")},
                    data={k: str(v) for k, v in form.items()})
    return r


# --- street names --------------------------------------------------------------

@pytest.mark.parametrize("osm_name, ledger_key", [
    ("вулиця Дениса Лукіяновича", "д. лукіяновича"),
    ("вулиця Андрія Луканюка", "а. луканюка"),
    ("вулиця Пилипа Орлика", "п. орлика"),
    ("вулиця Васіле Александрі", "в. александрі"),
    ("вулиця Івана Франка", "і. франка"),
    ("Південно-Кільцева вулиця", "південно-кільцева"),
    ("бульвар Героїв Крут", "героїв крут"),
    ("1-й Піщаний провулок", "1-й піщаний"),
])
def test_osm_names_match_ledger_directly(osm_name, ledger_key):
    assert keys_match(ledger_key, street_key(osm_name))


def test_initial_does_not_match_other_first_letter():
    assert not keys_match("д. лукіяновича", street_key("вулиця Петра Лукіяновича"))


def test_aliases_point_to_existing_ledger_keys():
    ledger_keys = {(c["locality"], k) for c in CONTRACTS for k in c["street_keys"]}
    for (locality, osm_key), rows in load_aliases(main.ALIASES_PATH).items():
        for a in rows:
            assert (locality, a["ledger_key"]) in ledger_keys, a
            assert a["source_url"] and a["evidence"], a
            assert a["kind"] in {"renamed", "case_form"}, a
            # an alias that keys_match already covers is dead weight
            assert not keys_match(a["ledger_key"], osm_key), a


# --- summary wording: a possible warranty case, not a verdict on liability ------

def fake(verdict, confidence=None, until=None, status="found", contractor="ТОВ «Тест»"):
    return {"verdict": verdict, "warranty_confidence": confidence, "warranty_until": until,
            "status_check": status, "contractor": contractor}


STREET = {"name": "вулиця Зелена", "key": "зелена"}
LOC = {"lat": 48.3, "lon": 25.9, "source": "manual"}
DEFECT = [{"class": "pothole"}]


def test_summary_active_high():
    s = main.summarize(LOC, STREET, True, [fake("active", "high", "2036-12-31")], DEFECT)
    assert s["title"] == "Можливий гарантійний випадок"
    assert s["headline"] == (
        "На цій вулиці є договір на ремонт з гарантією орієнтовно до 31.12.2036. "
        "Якщо дефект на ділянці, яку ремонтував ТОВ «Тест», його можуть зобов’язати "
        "усунути дефект за власний рахунок.")


def test_summary_active_medium_needs_check():
    s = main.summarize(LOC, STREET, True, [fake("active", "medium", "2030-01-01")], DEFECT)
    assert s["verdict"] == "active"
    assert s["title"] == "Потребує перевірки"
    assert "орієнтовно до 01.01.2030 за умовами проєкту договору." in s["headline"]


def test_summary_never_states_liability():
    for c in ([fake("active", "high", "2036-12-31")], [fake("expired", "high", "2024-01-01")]):
        h = main.summarize(LOC, STREET, True, c, DEFECT)["headline"]
        assert "має усунути" not in h and "зобов'язаний" not in h


def test_summary_expired():
    s = main.summarize(LOC, STREET, True, [fake("expired", "medium", "2024-12-31")], DEFECT)
    assert s["title"] == "Гарантія, ймовірно, закінчилась"
    assert "закінчилась орієнтовно 31.12.2024" in s["headline"]


def test_summary_unknown_no_docs_vs_scan():
    s = main.summarize(LOC, STREET, True, [fake("unknown", status="no_docs")], DEFECT)
    assert s["title"] == "Недостатньо даних"
    assert s["headline"] == "Документів для перевірки гарантії на Prozorro не опубліковано."
    s = main.summarize(LOC, STREET, True, [fake("unknown", status="scan")], DEFECT)
    assert "не опубліковано" not in s["headline"]


def test_summary_no_contracts_coverage():
    s = main.summarize(LOC, STREET, True, [], [])
    assert s["title"] == "Ремонтів у базі немає"
    assert s["headline"].startswith("Дефектів не виявлено. ")
    assert "Департаменту інфраструктури та благоустрою за 2023–2026 роки" in s["headline"]


# --- contract site and number from Prozorro ------------------------------------

@pytest.mark.parametrize("title,site", [
    ("Капітальний ремонт дорожнього покриття вул. Льва Толстого (на ділянці від вул. Гідності до провулку Польового) "
     "в с. Коровія Чернівецької територіальної громади", "на ділянці від вул. Гідності до провулку Польового"),
    ("Послуги з благоустрою - поточний ремонт дорожнього покриття вул. Миргородської (в районі будинку № 9) в м. Чернівці",
     "в районі будинку № 9"),
    ("Послуги з благоустрою-поточний ремонт дорожнього покриття на вул. Маріупольській, 16-20 (відновлення "
     "асфальтобетонного покриття місць проведення земляних робіт) в м. Чернівці", "вул. Маріупольській, 16-20"),
    ("Послуги з благоустрою - поточний ремонт ділянки тротуарного покриття на вул. О. Богомольця в м. Чернівці", None),
])
def test_site_from_title(title, site):
    assert build_ledger.site_from_title(title) == site


@pytest.mark.parametrize("title,scope", [
    ("Капітальний ремонт баскетбольного поля, дворового покриття (відновлення елементів благоустрою) "
     "ЗОШ №20 на вул. Глібова, 12 в м. Чернівці", "territory"),
    ("Капітальний ремонт покриття (благоустрій) дитячого майданчика по вул. Авангардна, 47 в м. Чернівці", "territory"),
    ("Послуги з благоустрою - поточний ремонт покриття пішохідних доріжок на території КП \"Центр культури і "
     "дозвілля імені Тараса Шевченка\" на вул.Садова,1А в м. Чернівці", "territory"),
    ("Послуги з благоустрою-поточний ремонт тротуарного покриття міжбудинкового проїзду з торців будинків №27 і №31 "
     "на вул. Комарова в м. Чернівці", "territory"),
    ("Поточний ремонт тротуарного покриття на вул. В. Александрі, 14 і 46 (зупинки міського громадського "
     "транспорту) в м. Чернівці", "street"),
    ("Поточний ремонт дорожнього покриття проїзної частини мосту на вул. Перемоги в с. Коровія", "street"),
    ("Капітальний ремонт дорожнього покриття перехрестя вулиць О. Масикевич, Староленківської та 1-го провулку "
     "Піщаний", "street"),
])
def test_scope_from_title(title, scope):
    got, basis = build_ledger.scope_from_title(title)
    assert got == scope
    assert (basis is None) == (scope == "street")


def test_scope_in_contracts_json():
    assert {c["scope"] for c in CONTRACTS} == {"street", "territory"}
    for c in CONTRACTS:
        assert c["scope"] == build_ledger.scope_from_title(c["title"])[0], c["contract_id"]


def test_analyze_never_returns_territory(client, offline):
    for lat, lon in RECORDED:
        body = analyze(client, jpeg(), lat=lat, lon=lon).json()
        assert all(c["scope"] == "street" for c in body["contracts"])
        assert all(c["scope"] == "territory" for c in body["other_works"])


def test_other_works_next_to_street_contracts(client, offline):
    """Сергія Скальда: «Комарова 2А» (sidewalk) is a street contract; the driveway at 27 і 31 and
    «Героїв Майдану 107 / С. Скальда 33А» are other works."""
    body = analyze(client, jpeg(), lat=SKALDA[0], lon=SKALDA[1]).json()
    assert {c["contract_id"] for c in body["contracts"]} == ids_with_key("комарова") | ids_with_key("с. скальда")
    assert {c["contract_id"] for c in body["other_works"]} == (
        ids_with_key("комарова", "territory") | ids_with_key("с. скальда", "territory"))
    assert body["other_works"]


def test_no_location_has_no_other_works(client, offline):
    assert analyze(client, jpeg()).json()["other_works"] == []


def test_contracts_endpoint_keeps_territory(client):
    got = client.get("/contracts").json()
    assert len(got) == len(CONTRACTS)
    assert any(c["scope"] == "territory" for c in got)


def test_every_contract_has_prozorro_number_and_date():
    for c in CONTRACTS:
        assert c["contract_number"] and c["date_signed"], c["contract_id"]
        assert c["contract_url"].startswith("https://public-api.prozorro.gov.ua/api/2.5/contracts/")


# --- /analyze ------------------------------------------------------------------

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["contracts"] == len(CONTRACTS)


def test_renamed_street_from_exif_skips_territory(client, offline):
    """OSM says «Українських Добровольців», the ledger has «Білоруська, 77»: both contracts there
    are the roof and yard of school № 16, so nothing is matched to a street defect."""
    body = analyze(client, jpeg(gps=BILORUSKA)).json()
    assert body["location"]["source"] == "exif"
    assert body["location"]["lat"] == pytest.approx(BILORUSKA[0], abs=1e-5)
    assert body["street"]["key"] == "українських добровольців"
    assert ids_with_key("білоруська") == set()
    assert len(ids_with_key("білоруська", "territory")) == 2
    assert body["contracts"] == []
    assert body["summary"]["verdict"] == "no_contracts"
    # listed as other works at this address, still through the renamed-street alias
    got = {c["contract_id"]: c for c in body["other_works"]}
    assert set(got) == ids_with_key("білоруська", "territory")
    for c in got.values():
        assert c["scope"] == "territory"
        assert c["matched_alias"]["kind"] == "renamed"
    # active warranty on the school yard does not turn the street verdict into active
    assert got["UA-2023-08-02-010386-a-c1"]["verdict"] == "active"


def test_renamed_street_keeps_direct_matches(client, offline):
    """Сергія Скальда: «С. Скальда, 33А» matches directly, «Комарова» via the alias."""
    body = analyze(client, jpeg(), lat=SKALDA[0], lon=SKALDA[1]).json()
    assert body["location"]["source"] == "manual"
    got = {c["contract_id"]: c["matched_alias"] for c in body["contracts"]}
    assert set(got) == ids_with_key("с. скальда") | ids_with_key("комарова")
    for cid in ids_with_key("с. скальда"):
        assert got[cid] is None
    for cid in ids_with_key("комарова"):
        assert got[cid]["ledger_key"] == "комарова"
        assert got[cid]["kind"] == "renamed"
    assert ids_with_key("комарова")  # «Комарова 2А», sidewalk
    assert not set(got) & ids_with_key("комарова", "territory")  # inter-block driveway at 27 і 31


def test_case_form_alias(client, offline):
    body = analyze(client, jpeg(), lat=STAROLENKIVSKA[0], lon=STAROLENKIVSKA[1]).json()
    got = {c["contract_id"]: c["matched_alias"] for c in body["contracts"]}
    assert set(got) == {"UA-2024-06-24-010117-a-a1"}
    assert got["UA-2024-06-24-010117-a-a1"]["kind"] == "case_form"


def test_initials_match_without_alias(client, offline):
    body = analyze(client, jpeg(), lat=LUKIIANOVYCHA[0], lon=LUKIIANOVYCHA[1]).json()
    assert {c["contract_id"] for c in body["contracts"]} == ids_with_key("д. лукіяновича")
    assert all(c["matched_alias"] is None for c in body["contracts"])


def test_verdicts_follow_contracts_json(client, offline):
    body = analyze(client, jpeg(), lat=SKALDA[0], lon=SKALDA[1]).json()
    today = main.dt.date.today()
    for c in body["contracts"]:
        until = c["warranty_until"]
        expected = "unknown" if not until else ("active" if main.dt.date.fromisoformat(until) >= today else "expired")
        assert c["verdict"] == expected, c["contract_id"]


def test_no_location(client, offline):
    body = analyze(client, jpeg()).json()
    assert body["location"] is None
    assert body["contracts"] == []
    assert body["summary"]["verdict"] == "no_location"


def test_outside_chernivtsi_skips_geocoding(client, monkeypatch):
    def fail(lat, lon):
        raise AssertionError("Nominatim must not be called outside the bbox")
    monkeypatch.setattr(main, "reverse_geocode", fail)
    body = analyze(client, jpeg(), lat=50.4501, lon=30.5234).json()  # Kyiv
    assert body["summary"]["verdict"] == "no_contracts"
    assert body["street"] is None


def test_lat_without_lon(client):
    assert analyze(client, jpeg(), lat=48.29).status_code == 422


def test_not_an_image(client):
    r = client.post("/analyze", files={"image": ("a.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400


# --- map screen geocoding ------------------------------------------------------

def test_geocode_reverse(client, offline):
    assert client.get("/geocode/reverse", params={"lat": SKALDA[0], "lon": SKALDA[1]}).json() == {
        "street": "вулиця Сергія Скальда", "in_city": True}


def test_geocode_reverse_outside_city(client, monkeypatch):
    monkeypatch.setattr(main, "reverse_geocode", lambda lat, lon: pytest.fail("called outside the bbox"))
    body = client.get("/geocode/reverse", params={"lat": 50.4501, "lon": 30.5234}).json()
    assert body == {"street": None, "in_city": False}


def test_geocode_search_keeps_city_streets_once(client, monkeypatch):
    calls = []

    def fake(path, params):
        calls.append((path, params))
        return [
            {"lat": "48.2925", "lon": "25.9365", "address": {"road": "Головна вулиця", **CITY}},
            {"lat": "48.2800", "lon": "25.9400", "address": {"road": "Головна вулиця", **CITY}},  # another way, same street
            {"lat": "48.2900", "lon": "25.9300", "address": {"road": "Головна вулиця", "house_number": "1", **CITY}},
            {"lat": "48.3500", "lon": "25.8500", "address": {"road": "Головна вулиця", "village": "Сусіднє"}},
            {"lat": "48.2900", "lon": "25.9300", "address": {"city": "Чернівці"}},  # no road
        ]
    monkeypatch.setattr(main, "nominatim", fake)
    results = client.get("/geocode/search", params={"q": "Головна"}).json()["results"]
    assert [r["name"] for r in results] == ["Головна вулиця", "Головна вулиця, 1"]
    assert results[0] == {"name": "Головна вулиця", "place": "Чернівці", "lat": 48.2925, "lon": 25.9365}
    path, params = calls[0]
    assert path == "search" and params["bounded"] == 1 and params["viewbox"] == "25.8,48.4,26.1,48.2"


def test_geocode_search_short_query_skips_nominatim(client, monkeypatch):
    monkeypatch.setattr(main, "nominatim", lambda path, params: pytest.fail("called for a short query"))
    assert client.get("/geocode/search", params={"q": " ab "}).json() == {"results": []}


@pytest.mark.skipif(not CROPS.exists(), reason="_import/photos/crops is local only")
def test_real_photo_detections(client, offline):
    # pothole conf 0.70 / 0.63 / 0.54 when checked on 2026-10-28
    photo = CROPS / "khotynska_typovi-chernivtsi_2026-02-26_01.jpg"
    body = analyze(client, photo.read_bytes()).json()
    assert "pothole" in {d["class"] for d in body["detections"]}
    for d in body["detections"]:
        assert d["class"] in {"crack", "patching", "pothole"}
        x1, y1, x2, y2 = d["box"]
        assert 0 <= x1 < x2 <= body["image_size"]["width"]
        assert 0 <= y1 < y2 <= body["image_size"]["height"]


@pytest.mark.skipif(os.environ.get("RUN_LIVE") != "1", reason="set RUN_LIVE=1 to call the real Nominatim")
@pytest.mark.parametrize("point", list(RECORDED))
def test_live_nominatim_agrees_with_recording(point):
    main.state.setdefault("http", main.httpx.Client(headers={"User-Agent": main.USER_AGENT}, timeout=10))
    assert main.reverse_geocode(*point)["address"]["road"] == RECORDED[point]
