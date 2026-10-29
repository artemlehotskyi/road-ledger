"""One-off: download the streets of Chernivtsi city hromada from OpenStreetMap (Overpass API) into data/streets_cv.json.

Run: cd api && .venv/bin/python build_streets.py
Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).

Every named highway line whose middle is inside the hromada boundary is kept with name, old_name, alt_name and geometry.
Each line gets the locality the ledger uses: None inside the city of Chernivtsi, otherwise the village
(admin boundary if OSM has one, else the nearest village node).
"""
import datetime as dt
import json
import time
from pathlib import Path

import httpx
from shapely.geometry import LineString, Point
from shapely.ops import linemerge, polygonize, unary_union

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "RoadLedger/0.1 (build_streets)"
HROMADA_REL = 12461821  # Чернівецька міська громада, admin_level 7
CITY_REL = 1742393      # Чернівці, admin_level 9
OUT = Path(__file__).resolve().parent / "data" / "streets_cv.json"

QUERY = f"""[out:json][timeout:180];
area(id:{3600000000 + HROMADA_REL})->.a;
rel(id:{HROMADA_REL},{CITY_REL});out geom;
rel(area.a)["boundary"="administrative"]["admin_level"="9"]["place"="village"];out geom;
node(area.a)["place"~"^(village|hamlet)$"];out;
way(area.a)["highway"]["name"];out tags geom;
"""


def fetch():
    """Overpass with exponential backoff: the public server answers 502/504/429 when busy."""
    wait = 5
    for _ in range(7):
        r = httpx.post(OVERPASS_URL, data={"data": QUERY}, headers={"User-Agent": USER_AGENT}, timeout=240)
        if r.status_code == 200:
            return r.json()["elements"]
        print(f"Overpass HTTP {r.status_code}, retry in {wait} s")
        time.sleep(wait)
        wait *= 2
    raise SystemExit("Overpass did not answer")


def polygon(rel):
    """Outer member ways of a boundary relation -> one (multi)polygon."""
    lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in rel["members"] if m["type"] == "way" and m.get("role") == "outer" and m.get("geometry")]
    return unary_union(list(polygonize(linemerge(lines))))


def coords6(geom):
    return [[round(x, 6), round(y, 6)] for x, y in geom.coords]


def main():
    elements = fetch()
    rels = {e["id"]: e for e in elements if e["type"] == "relation"}
    hromada, city = polygon(rels[HROMADA_REL]), polygon(rels[CITY_REL])
    villages = [(rels[i]["tags"]["name"], polygon(rels[i])) for i in rels if i not in (HROMADA_REL, CITY_REL)]
    village_nodes = [(e["tags"]["name"], Point(e["lon"], e["lat"])) for e in elements if e["type"] == "node"]

    def locality(line):
        mid = line.interpolate(0.5, normalized=True)
        if city.contains(mid):
            return None
        for name, poly in villages:
            if poly.contains(mid):
                return name
        return min(village_nodes, key=lambda v: v[1].distance(mid))[0]

    ways = []
    for e in elements:
        if e["type"] != "way" or len(e.get("geometry") or []) < 2:
            continue
        line = LineString([(p["lon"], p["lat"]) for p in e["geometry"]])
        # Overpass returns lines with any node inside; keep those that lie mostly inside the hromada
        if not hromada.contains(line.interpolate(0.5, normalized=True)):
            continue
        t = e["tags"]
        ways.append({
            "id": e["id"], "name": t["name"], "old_name": t.get("old_name"), "alt_name": t.get("alt_name"),
            "highway": t["highway"], "locality": locality(line), "coords": coords6(line),
        })
    ways.sort(key=lambda w: (w["locality"] or "", w["name"], w["id"]))

    boundary = hromada.simplify(0.0001)  # ~10 m, only for the «inside the hromada» check
    polys = list(boundary.geoms) if boundary.geom_type == "MultiPolygon" else [boundary]
    OUT.write_text(json.dumps({
        "_about": "Named highway lines of Chernivtsi city hromada from OpenStreetMap (Overpass API), built by "
                  "build_streets.py. Data © OpenStreetMap contributors, ODbL 1.0, "
                  "https://www.openstreetmap.org/copyright. locality: null = city of Chernivtsi.",
        "built": dt.date.today().isoformat(),
        "hromada_relation": HROMADA_REL,
        "boundary": [coords6(p.exterior) for p in polys],
        "ways": ways,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    names = {(w["locality"], w["name"]) for w in ways}
    print(f"{len(ways)} lines, {len(names)} unique streets (name + locality) -> {OUT.name}, "
          f"{OUT.stat().st_size / 1e6:.1f} MB")
    by_loc = {}
    for loc, _ in names:
        by_loc[loc or "Чернівці"] = by_loc.get(loc or "Чернівці", 0) + 1
    print("by locality:", by_loc)


if __name__ == "__main__":
    main()
