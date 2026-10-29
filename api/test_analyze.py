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


def ids_with_key(key):
    return {c["contract_id"] for c in CONTRACTS if key in c["street_keys"]}


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


# --- /analyze ------------------------------------------------------------------

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["contracts"] == len(CONTRACTS)


def test_renamed_street_from_exif(client, offline):
    """OSM says «Українських Добровольців», the ledger has «Білоруська, 77»."""
    body = analyze(client, jpeg(gps=BILORUSKA)).json()
    assert body["location"]["source"] == "exif"
    assert body["location"]["lat"] == pytest.approx(BILORUSKA[0], abs=1e-5)
    assert body["street"]["key"] == "українських добровольців"
    got = {c["contract_id"]: c for c in body["contracts"]}
    assert set(got) == ids_with_key("білоруська")
    for c in got.values():
        assert c["matched_alias"]["kind"] == "renamed"
        assert c["matched_alias"]["source_url"] == "https://www.openstreetmap.org/way/155141393"
    # signed contract, warranty until 2035-05-05 in contracts.json
    assert got["UA-2023-08-02-010386-a-c1"]["verdict"] == "active"
    assert body["summary"]["verdict"] == "active"
    assert "05.05.2035" in body["summary"]["headline"]


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
