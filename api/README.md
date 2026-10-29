# Road Ledger API

FastAPI service behind the Road Ledger app. You send it a photo of a road. It does four things:

1. **Detect defects.** The YOLO11s model (`../model/weights/best.pt`) finds `pothole`, `patching` and `crack`. A crack is reported only at confidence ≥ 0.5, the other classes at ≥ 0.25.
2. **Locate the photo.** It uses `lat`/`lon` from the form if they are sent, otherwise the EXIF GPS of the photo. The street is the nearest named street line within 60 m in a local copy of the OpenStreetMap streets of Chernivtsi city hromada (`data/streets_cv.json`). Only when no line is that close, Nominatim (OpenStreetMap) reverse geocoding is asked as a fallback; its answer counts only for a street missing from the local copy, because Nominatim itself has no distance limit. Points outside the hromada boundary are not looked up. All Nominatim calls (reverse and search) share one in-memory cache and one limit of 1 request per second, with the `RoadLedger/0.1` User-Agent.
3. **Match repair contracts.** It finds the repair contracts for that street in `data/contracts.json` (public Prozorro data). The match is by normalized street name, and initials match full first names. `data/street_aliases.json` covers streets that were renamed or that are spelled in a different grammatical case in the contract. Every alias has an OpenStreetMap source.
4. **Give a warranty verdict.** Possible verdicts: `active`, `expired`, `unknown`, `no_contracts`, `no_location`. Each comes with a Ukrainian title and headline. The API points to a *possible* warranty case to check; it does not establish the contractor's liability. Warranty end dates are estimates computed from the contract period, not from the works acceptance act.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/analyze` | multipart form: `image` (required), `lat` + `lon` (optional, passed together). Returns detections, location, street, matched contracts (with `verdict`, `warranty_confidence`, `matched_alias`) and `summary`. |
| `GET` | `/contracts` | the full contract ledger (`data/contracts.json`) |
| `GET` | `/geocode/reverse?lat=&lon=` | nearest street for the map screen: `{street, in_city, geocode}`. Same lookup as `/analyze`. `geocode` = `{status: found / none / outside / error, source: local / nominatim, distance_m, detail}`, without coordinates; `/analyze` returns it too. |
| `GET` | `/geocode/search?q=` | streets of the hromada from the local index: `{results: [{name, place, lat, lon}]}`, at most 8. Name prefix first, then a match inside the name, then a fuzzy match (typos); case forms («Вишневу», «Зеленій») and «вул.» are normalized. A street in several disconnected parts gives one row per part. Queries shorter than 3 characters return nothing. |
| `GET` | `/health` | status, inference device, number of contracts |

Interactive docs: `http://127.0.0.1:8000/docs`.

## Run locally

```bash
cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload
```

```bash
curl -F image=@photo.jpg -F lat=48.2982 -F lon=25.9498 http://127.0.0.1:8000/analyze
```

## Tests

```bash
cd api
.venv/bin/pytest -q                       # offline: Nominatim replaced with recorded responses
RUN_LIVE=1 .venv/bin/pytest -q -k live    # also check the recorded points against the real Nominatim
```

`test_real_photo_detections` needs local road photos in `../_import/photos/crops/`. That folder is not in the repository, so without it the test is skipped (`pytest.skip`). All other tests use generated images.

## Server (CPU-only)

On a Linux server without a GPU, install torch from the CPU index **before** the requirements. Otherwise pip pulls the CUDA wheels, which take several GB:

```bash
pip install torch==2.15.0 torchvision==0.29.2 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

CORS currently allows only `localhost` / `127.0.0.1`. Add the frontend domain in `main.py` before deploying, or serve the API and the frontend from one domain.

## Privacy

Photos and coordinates are not written to disk:

- uploads are kept in memory (Starlette's spool threshold is raised from 1 MB to the upload limit), and `POST` bodies over 25 MB or without `Content-Length` are refused (413 / 411);
- the uvicorn access log drops the query string, so `/geocode/*` coordinates and search text are not logged;
- the model is called without `save`, and the Nominatim cache lives in memory only.

Search text never leaves the server. Coordinates are sent to Nominatim (OpenStreetMap Foundation, which has its own logs) only in the fallback case, when no street line of the local index is within 60 m. If a reverse proxy sits in front (e.g. Caddy), keep its access log off or make sure it does not record query strings.

## Data

- `data/contracts.json` is built from the verified ledger by `build_ledger.py`. The source xlsx is not in the repository.
- `data/streets_cv.json`: named highway lines of Chernivtsi city hromada (name, old_name, alt_name, geometry, locality), downloaded once from the Overpass API by `build_streets.py`. **© OpenStreetMap contributors, ODbL 1.0** (https://www.openstreetmap.org/copyright). Rebuild: `.venv/bin/python build_streets.py`.
- Street names: © OpenStreetMap contributors, ODbL.
- Contract data: Prozorro public API.
