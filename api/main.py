"""Road Ledger API: road photo -> defects, street, contractor warranty verdict.

Run: cd api && .venv/bin/uvicorn main:app --reload
"""
import datetime as dt
import io
import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import torch
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.formparsers import MultiPartParser
from ultralytics import YOLO

import street_index
from streets import keys_match, load_aliases, street_key

API_DIR = Path(__file__).resolve().parent
WEIGHTS = API_DIR.parent / "model" / "weights" / "best.pt"
CONTRACTS_PATH = API_DIR / "data" / "contracts.json"
ALIASES_PATH = API_DIR / "data" / "street_aliases.json"
STREETS_PATH = API_DIR / "data" / "streets_cv.json"

CONF = 0.25
CLASS_MIN_CONF = {"crack": 0.5}

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "RoadLedger/0.1"
CHERNIVTSI_NAMES = {"Чернівці", "Чернівецька міська громада"}

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# --- privacy: photos and coordinates never reach the disk ----------------------
# Starlette spools uploads over 1 MB to a temporary file; keep the whole photo in memory instead,
# and refuse bodies that could still overflow to disk.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MultiPartParser.spool_max_size = MAX_UPLOAD_BYTES + 1


class DropQueryString(logging.Filter):
    """uvicorn's access log prints the full path; /geocode/* carries coordinates and search text in the query."""

    def filter(self, record):
        # uvicorn.access args: (client_addr, method, full_path, http_version, status_code)
        if isinstance(record.args, tuple) and len(record.args) == 5 and isinstance(record.args[2], str):
            args = list(record.args)
            args[2] = args[2].split("?", 1)[0]
            record.args = tuple(args)
        return True


logging.getLogger("uvicorn.access").addFilter(DropQueryString())

state = {}


@asynccontextmanager
async def lifespan(app):
    state["model"] = YOLO(str(WEIGHTS))
    # one inference on a blank image: the first real request doesn't pay ~4 s of lazy setup
    state["model"].predict(Image.new("RGB", (640, 640)), device=DEVICE, verbose=False)
    state["model_lock"] = threading.Lock()
    state["contracts"] = json.loads(CONTRACTS_PATH.read_text(encoding="utf-8"))
    state["aliases"] = load_aliases(ALIASES_PATH)
    state["streets"] = street_index.load(STREETS_PATH)
    state["http"] = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=10)
    yield
    state["http"].close()


app = FastAPI(title="Road Ledger API", version="0.1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_upload(request: Request, call_next):
    if request.method == "POST":
        size = request.headers.get("content-length")
        if size is None:
            return JSONResponse({"detail": "Content-Length required"}, status_code=411)
        if not size.isdigit() or int(size) > MAX_UPLOAD_BYTES:
            return JSONResponse({"detail": f"upload larger than {MAX_UPLOAD_BYTES // 2**20} MB"}, status_code=413)
    return await call_next(request)


# --- detection ---------------------------------------------------------------

def detect(image):
    with state["model_lock"]:
        result = state["model"].predict(image, conf=CONF, device=DEVICE, verbose=False)[0]
    detections = []
    for box in result.boxes:
        cls = result.names[int(box.cls)]
        conf = float(box.conf)
        if conf < CLASS_MIN_CONF.get(cls, CONF):
            continue
        detections.append({
            "class": cls,
            "confidence": round(conf, 3),
            "box": [round(v, 1) for v in box.xyxy[0].tolist()],
        })
    return sorted(detections, key=lambda d: -d["confidence"])


# --- location ----------------------------------------------------------------

def exif_gps(image):
    gps = image.getexif().get_ifd(0x8825)
    if not gps or 2 not in gps or 4 not in gps:
        return None

    def to_deg(dms, ref):
        d, m, s = (float(x) for x in dms)
        deg = d + m / 60 + s / 3600
        return -deg if ref in ("S", "W") else deg

    try:
        lat = to_deg(gps[2], gps.get(1, "N"))
        lon = to_deg(gps[4], gps.get(3, "E"))
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return round(lat, 6), round(lon, 6)


class GeocodeError(Exception):
    """Nominatim failed; the message is safe to show (no coordinates)."""


_geo_cache = {}
_geo_lock = threading.Lock()
_geo_last_call = [0.0]


def nominatim(path, params):
    """One Nominatim request, cached in memory; at most 1 request/s across all endpoints per the usage policy."""
    key = (path, tuple(sorted(params.items())))
    if key in _geo_cache:
        return _geo_cache[key]
    with _geo_lock:
        if key in _geo_cache:
            return _geo_cache[key]
        wait = 1.0 - (time.monotonic() - _geo_last_call[0])
        if wait > 0:
            time.sleep(wait)
        try:
            r = state["http"].get(f"{NOMINATIM_URL}/{path}", params={
                **params, "format": "jsonv2", "addressdetails": 1, "accept-language": "uk"})
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPStatusError as e:
            raise GeocodeError(f"HTTP {e.response.status_code}")
        except (httpx.HTTPError, ValueError) as e:
            # the class name only: httpx messages carry the request URL with the coordinates
            raise GeocodeError(type(e).__name__)
        finally:
            _geo_last_call[0] = time.monotonic()
        _geo_cache[key] = data
        return data


def reverse_geocode(lat, lon):
    return nominatim("reverse", {"lat": round(lat, 5), "lon": round(lon, 5), "zoom": 17})


def address_in_city(address):
    return bool(CHERNIVTSI_NAMES & {address.get("city"), address.get("municipality")})


def resolve_street(lat, lon):
    """Returns (street, locality, in_city, geocode). street is {name, key} or None.
    The local OSM street index answers first; Nominatim only when no street line is within 60 m,
    and its answer counts only for a street missing from the index.
    geocode describes the lookup for the debug panel and never contains coordinates."""
    hit = state["streets"].reverse(lat, lon)
    if hit["status"] == "outside":
        return None, None, False, {"status": "outside", "source": "local", "distance_m": None, "detail": None}
    if hit["status"] == "found":
        street = {"name": hit["name"], "key": street_key(hit["name"])}
        return street, hit["locality"], True, {"status": "found", "source": "local",
                                                "distance_m": hit["distance_m"], "detail": None}
    nearest = hit["distance_m"]
    try:
        address = reverse_geocode(lat, lon).get("address") or {}
    except GeocodeError as e:
        return None, None, True, {"status": "error", "source": "nominatim", "distance_m": nearest, "detail": str(e)}
    name = address.get("road")
    if not name or not address_in_city(address):
        return None, None, True, {"status": "none", "source": "nominatim", "distance_m": nearest,
                                  "detail": f"nearest street line {nearest} m away"}
    # Villages of the city hromada (e.g. Коровія) are matched separately from city streets.
    locality = None if address.get("city") == "Чернівці" else address.get("village") or address.get("hamlet")
    # Nominatim has no distance limit: a street the index already has is the one that is over 60 m away.
    # Only a street missing from the index (newer OSM data) is accepted.
    if state["streets"].has(name, locality):
        return None, None, True, {"status": "none", "source": "nominatim", "distance_m": nearest,
                                  "detail": f"Nominatim: «{name}», over 60 m"}
    return {"name": name, "key": street_key(name)}, locality, True, {
        "status": "found", "source": "nominatim", "distance_m": nearest, "detail": None}


# --- ledger ------------------------------------------------------------------

def find_contracts(street, locality, scope="street"):
    """Contracts of one scope on the street. Returns [(contract, alias)]; alias is None for a direct name match,
    else the data/street_aliases.json row (renamed street or another case form in the ledger).
    Only scope="street" feeds the verdict; "territory" (school yards etc.) is listed as other works."""
    aliases = state["aliases"].get((locality, street["key"]), [])
    found = []
    for c in state["contracts"]:
        if c["scope"] != scope or c["locality"] != locality:
            continue
        if any(keys_match(k, street["key"]) for k in c["street_keys"]):
            found.append((c, None))
            continue
        alias = next((a for a in aliases if a["ledger_key"] in c["street_keys"]), None)
        if alias:
            found.append((c, alias))
    return found


def alias_info(alias):
    if alias is None:
        return None
    return {k: alias[k] for k in ("ledger_key", "kind", "source_url", "evidence")}


WARRANTY_CONFIDENCE = {
    "signed_contract": "high",       # text of the signed contract
    "signed_contract_scan_manual": "high",  # signed contract is a scan, term checked by hand (page and clause noted)
    "contract_attachment": "medium",  # draft-contract form uploaded to the contract
    "tender_draft": "medium",         # draft contract in the tender documentation
}
DRAFT_TERMS = " за умовами проєкту договору"
CONFIDENCE_RANK = {"high": 2, "medium": 1}


def headline_priority(contract):
    """Contract shown in the headline: higher warranty_confidence first, then the later warranty end date."""
    return CONFIDENCE_RANK.get(contract["warranty_confidence"], 0), contract["warranty_until"]


def warranty_confidence(contract):
    if contract["warranty_months"] is None:
        return None
    return WARRANTY_CONFIDENCE.get(contract["warranty_source"])


def verdict(contract, today):
    until = contract["warranty_until"]
    if not until:
        return "unknown"
    return "active" if dt.date.fromisoformat(until) >= today else "expired"


def fmt_date(iso):
    return dt.date.fromisoformat(iso).strftime("%d.%m.%Y")


VERDICT_TITLE = {
    "active_high": "Можливий гарантійний випадок",
    "active_medium": "Потребує перевірки",
    "expired": "Гарантія, ймовірно, закінчилась",
    "unknown": "Недостатньо даних",
    "no_contracts": "Ремонтів у базі немає",
    "no_location": "Немає координат",
    "outside": "Точка поза зоною перевірки",
}
OUTSIDE = ("Ми перевіряємо договори на вулицях Чернівецької громади. Геолокація неточна або фото зроблене "
           "за межами міста. Вкажіть місце дефекту на карті.")
COVERAGE = "База охоплює договори Департаменту інфраструктури та благоустрою за 2023–2026 роки."


def summarize(location, street, in_city, contracts, detections):
    """We don't establish the contractor's liability: the summary points to a possible warranty case to check."""
    defects = "Дефектів не виявлено. " if not detections else ""

    def out(verdict, headline, title_key=None):
        return {"verdict": verdict, "title": VERDICT_TITLE[title_key or verdict], "headline": defects + headline}

    if location is None:
        return out("no_location", "Немає координат: додайте геолокацію, щоб перевірити гарантію.")
    # outside the hromada, or no street within 60 m: we can't say there were no repairs
    if not in_city or street is None:
        return out("outside", OUTSIDE)
    if not contracts:
        return out("no_contracts", f"На вулиці «{street['name']}» договорів на ремонт у базі немає. {COVERAGE}")

    active = [c for c in contracts if c["verdict"] == "active"]
    if active:
        c = max(active, key=headline_priority)
        terms = DRAFT_TERMS if c["warranty_confidence"] == "medium" else ""
        return out("active", (
            f"На цій вулиці є договір на ремонт з гарантією орієнтовно до {fmt_date(c['warranty_until'])}{terms}. "
            f"Якщо дефект на ділянці, яку ремонтував {c['contractor']}, його можуть зобов’язати "
            f"усунути дефект за власний рахунок."), f"active_{c['warranty_confidence']}")
    unknown = [c for c in contracts if c["verdict"] == "unknown"]
    if unknown:
        if all(c["status_check"] == "no_docs" for c in unknown):
            return out("unknown", "Документів для перевірки гарантії на Prozorro не опубліковано.")
        return out("unknown", "Ремонт тут був, але строку гарантії в документах на Prozorro не знайдено.")
    c = max(contracts, key=headline_priority)
    terms = DRAFT_TERMS if c["warranty_confidence"] == "medium" else ""
    return out("expired", (
        f"Гарантія підрядника {c['contractor']}{terms} закінчилась орієнтовно {fmt_date(c['warranty_until'])}."))


# --- routes ------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "contracts": len(state["contracts"])}


@app.get("/contracts")
def contracts():
    return state["contracts"]


@app.get("/geocode/reverse")
def geocode_reverse(lat: float, lon: float):
    """Nearest street for the map screen, the same lookup /analyze uses."""
    street, _, inside, geocode = resolve_street(lat, lon)
    return {"street": street["name"] if street else None, "in_city": inside, "geocode": geocode}


@app.get("/geocode/search")
def geocode_search(q: str):
    """Streets of the hromada by name, from the local index (case forms and typos tolerated); max 8."""
    if len(q.strip()) < 3:
        return {"results": []}
    return {"results": state["streets"].search(q)}


@app.post("/analyze")
def analyze(image: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None)):
    if (lat is None) != (lon is None):
        raise HTTPException(422, "lat and lon must be passed together")
    try:
        img = Image.open(io.BytesIO(image.file.read()))
        gps = exif_gps(img)
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "file is not a readable image")

    detections = detect(img)

    if lat is not None:
        location = {"lat": lat, "lon": lon, "source": "manual"}
    elif gps:
        location = {"lat": gps[0], "lon": gps[1], "source": "exif"}
    else:
        location = None

    street, locality, in_city, matched, other_works, geocode = None, None, False, [], [], None
    if location:
        street, locality, in_city, geocode = resolve_street(location["lat"], location["lon"])
        if street:
            today = dt.date.today()

            def enrich(found):
                return [
                    {**c, "verdict": verdict(c, today), "warranty_confidence": warranty_confidence(c),
                     "matched_alias": alias_info(alias)}
                    for c, alias in found
                ]
            matched = enrich(find_contracts(street, locality))
            # works on the grounds of institutions at this street: shown, but not part of the verdict
            other_works = enrich(find_contracts(street, locality, "territory"))

    return {
        "detections": detections,
        "image_size": {"width": img.width, "height": img.height},
        "location": location,
        "street": street,
        "geocode": geocode,
        "contracts": matched,
        "other_works": other_works,
        "summary": summarize(location, street, in_city, matched, detections),
    }
