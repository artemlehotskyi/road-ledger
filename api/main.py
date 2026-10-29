"""Road Ledger API: road photo -> defects, street, contractor warranty verdict.

Run: cd api && .venv/bin/uvicorn main:app --reload
"""
import datetime as dt
import io
import json
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError
from ultralytics import YOLO

from streets import keys_match, load_aliases, street_key

API_DIR = Path(__file__).resolve().parent
WEIGHTS = API_DIR.parent / "model" / "weights" / "best.pt"
CONTRACTS_PATH = API_DIR / "data" / "contracts.json"
ALIASES_PATH = API_DIR / "data" / "street_aliases.json"

CONF = 0.25
CLASS_MIN_CONF = {"crack": 0.5}

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "RoadLedger/0.1"
# Rough box around Chernivtsi city hromada; the authoritative check is Nominatim's address.
CHERNIVTSI_BBOX = (48.20, 25.80, 48.40, 26.10)  # lat_min, lon_min, lat_max, lon_max
CHERNIVTSI_NAMES = {"Чернівці", "Чернівецька міська громада"}

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

state = {}


@asynccontextmanager
async def lifespan(app):
    state["model"] = YOLO(str(WEIGHTS))
    state["model_lock"] = threading.Lock()
    state["contracts"] = json.loads(CONTRACTS_PATH.read_text(encoding="utf-8"))
    state["aliases"] = load_aliases(ALIASES_PATH)
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


_geo_cache = {}
_geo_lock = threading.Lock()
_geo_last_call = [0.0]


def reverse_geocode(lat, lon):
    """Nominatim reverse lookup, cached in memory; at most 1 request/s per the usage policy."""
    key = (round(lat, 5), round(lon, 5))
    if key in _geo_cache:
        return _geo_cache[key]
    with _geo_lock:
        if key in _geo_cache:
            return _geo_cache[key]
        wait = 1.0 - (time.monotonic() - _geo_last_call[0])
        if wait > 0:
            time.sleep(wait)
        try:
            r = state["http"].get(NOMINATIM_URL, params={
                "lat": lat, "lon": lon, "format": "jsonv2", "zoom": 17,
                "addressdetails": 1, "accept-language": "uk",
            })
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise HTTPException(502, f"Nominatim reverse geocoding failed: {e}")
        finally:
            _geo_last_call[0] = time.monotonic()
        _geo_cache[key] = data
        return data


def in_chernivtsi_bbox(lat, lon):
    lat_min, lon_min, lat_max, lon_max = CHERNIVTSI_BBOX
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


def resolve_street(lat, lon):
    """Returns (street, locality, in_city). street is {name, key} or None."""
    if not in_chernivtsi_bbox(lat, lon):
        return None, None, False
    data = reverse_geocode(lat, lon)
    address = data.get("address") or {}
    in_city = bool(CHERNIVTSI_NAMES & {address.get("city"), address.get("municipality")})
    if not in_city:
        return None, None, False
    # Villages of the city hromada (e.g. Коровія) are matched separately from city streets.
    locality = None if address.get("city") == "Чернівці" else address.get("village") or address.get("hamlet")
    name = address.get("road")
    if not name:
        return None, locality, True
    return {"name": name, "key": street_key(name)}, locality, True


# --- ledger ------------------------------------------------------------------

def find_contracts(street, locality):
    """Returns [(contract, alias)]; alias is None for a direct name match,
    else the data/street_aliases.json row (renamed street or another case form in the ledger)."""
    aliases = state["aliases"].get((locality, street["key"]), [])
    found = []
    for c in state["contracts"]:
        if c["locality"] != locality:
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


def summarize(location, street, in_city, contracts, detections):
    defects = "Дефектів не виявлено. " if not detections else ""
    if location is None:
        return {"verdict": "no_location",
                "headline": defects + "Немає координат: додайте геолокацію, щоб перевірити гарантію."}
    if not in_city:
        return {"verdict": "no_contracts", "headline": defects + "Точка поза межами Чернівців."}
    if street is None:
        return {"verdict": "no_contracts", "headline": defects + "Не вдалося визначити вулицю за координатами."}
    if not contracts:
        return {"verdict": "no_contracts",
                "headline": defects + f"На вулиці «{street['name']}» договорів на ремонт у базі немає."}

    active = [c for c in contracts if c["verdict"] == "active"]
    if active:
        c = max(active, key=headline_priority)
        terms = DRAFT_TERMS if c["warranty_confidence"] == "medium" else ""
        return {"verdict": "active", "headline": defects + (
            f"Гарантія діє орієнтовно до {fmt_date(c['warranty_until'])}{terms}: "
            f"дефекти має усунути підрядник {c['contractor']} за власний рахунок.")}
    if any(c["verdict"] == "unknown" for c in contracts):
        return {"verdict": "unknown", "headline": defects + (
            "Ремонт тут був, але строк гарантії невідомий: у документах на Prozorro його немає.")}
    c = max(contracts, key=headline_priority)
    terms = DRAFT_TERMS if c["warranty_confidence"] == "medium" else ""
    return {"verdict": "expired", "headline": defects + (
        f"Гарантія підрядника {c['contractor']}{terms} скінчилась орієнтовно {fmt_date(c['warranty_until'])}.")}


# --- routes ------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "contracts": len(state["contracts"])}


@app.get("/contracts")
def contracts():
    return state["contracts"]


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

    street, locality, in_city, matched = None, None, False, []
    if location:
        street, locality, in_city = resolve_street(location["lat"], location["lon"])
        if street:
            today = dt.date.today()
            matched = [
                {**c, "verdict": verdict(c, today), "warranty_confidence": warranty_confidence(c),
                 "matched_alias": alias_info(alias)}
                for c, alias in find_contracts(street, locality)
            ]

    return {
        "detections": detections,
        "image_size": {"width": img.width, "height": img.height},
        "location": location,
        "street": street,
        "contracts": matched,
        "summary": summarize(location, street, in_city, matched, detections),
    }
