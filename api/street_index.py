"""Local street index of Chernivtsi city hromada: search by name and point -> nearest street.

Built from data/streets_cv.json (build_streets.py; © OpenStreetMap contributors, ODbL), so neither the
search text nor the coordinates leave the server. Geometry is kept in metres (local equirectangular
projection around Chernivtsi; error well under a metre at 60 m distances).
"""
import json
import math
import re

from rapidfuzz import fuzz
from shapely import STRtree
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import nearest_points, unary_union

from streets import street_key

MAX_DISTANCE_M = 60
SEARCH_LIMIT = 8
FUZZY_MIN = 80
CLUSTER_GAP_M = 25  # lines of one street closer than this are one part of it
# not streets anyone drives on: never the answer to «which street is this pothole on»
NOT_FOR_REVERSE = {"footway", "path", "cycleway", "steps", "bridleway", "construction"}
NOT_BUILT = {"proposed"}

_LAT0 = 48.29
_KX = 111_320 * math.cos(math.radians(_LAT0))
_KY = 110_574

# street-type words in any case form; street_key() removes only the base forms
_TYPE_FORMS_RE = re.compile(r"\b(?:вулиц\w*|провул\w*|проспект\w*|бульвар\w*|площ\w*|узв[оі]з\w*|проїзд\w*|але[яюїє]\w*)\b")
# case endings reduced to a common stem: «вишневу», «вишневій», «вишневої» -> «вишнев»; «зеленій» -> «зелен»
_ENDINGS = ["ого", "ому", "ими", "ій", "ої", "ою", "ею", "єю", "ий", "ім", "их", "а", "у", "і", "ї", "я", "ю", "е", "є", "о", "и", "ь"]
_MIN_STEM = 3


def to_m(lon, lat):
    return lon * _KX, lat * _KY


def to_deg(x, y):
    return x / _KX, y / _KY


def stem(word):
    for end in _ENDINGS:
        if word.endswith(end) and len(word) - len(end) >= _MIN_STEM:
            return word[: -len(end)]
    return word


def search_tokens(text):
    """«вул вишневу» -> ["вишнев"]; «Дениса Лукіяновича» -> ["денис", "лукіянович"]."""
    s = _TYPE_FORMS_RE.sub(" ", (text or "").lower())
    key = street_key(s) or ""
    return [stem(w) for w in re.findall(r"[^\W\d_][\w'-]*|\d+\w*", key)]


class StreetIndex:
    def __init__(self, data):
        self.boundary = unary_union([Polygon([to_m(*p) for p in ring]) for ring in data["boundary"]])
        self.lines, self.ways = [], []
        streets = {}
        for w in data["ways"]:
            if w["highway"] in NOT_BUILT:
                continue
            line = LineString([to_m(*p) for p in w["coords"]])
            if w["highway"] not in NOT_FOR_REVERSE:
                self.lines.append(line)
                self.ways.append(w)
            s = streets.setdefault((w["locality"], w["name"]), {"lines": [], "names": {w["name"]}})
            s["lines"].append(line)
            for alt in (w.get("old_name"), w.get("alt_name")):
                s["names"].update(n.strip() for n in (alt or "").split(";") if n.strip())
        self.tree = STRtree(self.lines)
        self.names = {(loc, name) for loc, name in streets}
        self.entries = [self._entry(loc, name, s) for (loc, name), s in streets.items()]

    @staticmethod
    def _entry(locality, name, s):
        # parts of one street that don't touch (e.g. a street cut by a park) are separate search results
        blobs = unary_union([l.buffer(CLUSTER_GAP_M) for l in s["lines"]])
        blobs = list(blobs.geoms) if blobs.geom_type == "MultiPolygon" else [blobs]
        parts = []
        for blob in blobs:
            lines = MultiLineString([l for l in s["lines"] if blob.intersects(l.interpolate(0.5, normalized=True))])
            on_street = nearest_points(lines, lines.centroid)[0]
            parts.append((lines.length, to_deg(on_street.x, on_street.y)))
        parts.sort(key=lambda p: -p[0])  # longest part first
        return {
            "name": name, "locality": locality, "parts": [p[1] for p in parts],
            "tokens": [search_tokens(n) for n in sorted(s["names"], key=lambda n: n != name)],
        }

    def has(self, name, locality):
        return (locality, name) in self.names

    def reverse(self, lat, lon):
        """{status: outside | found | none, distance_m, name, locality}; found only within MAX_DISTANCE_M."""
        p = Point(to_m(lon, lat))
        if not self.boundary.contains(p):
            return {"status": "outside"}
        idx, dist = self.tree.query_nearest(p, return_distance=True)
        if not len(idx):
            return {"status": "none", "distance_m": None}
        way, d = self.ways[int(idx[0])], float(dist[0])
        if d > MAX_DISTANCE_M:
            return {"status": "none", "distance_m": round(d)}
        return {"status": "found", "distance_m": round(d), "name": way["name"], "locality": way["locality"]}

    def search(self, q, limit=SEARCH_LIMIT):
        """Prefix of the name first, then a match inside the name, then a fuzzy match (typos)."""
        query = search_tokens(q)
        if not query:
            return []
        joined = " ".join(query)
        ranked = []
        for e in self.entries:
            best = None
            for i, tokens in enumerate(e["tokens"]):  # tokens[0] is the current name, then old/alt names
                if not tokens:
                    continue
                if len(query) <= len(tokens) and all(t.startswith(qt) for qt, t in zip(query, tokens)):
                    rank = (0, i > 0, 0)
                elif all(any(qt in t for t in tokens) for qt in query):
                    rank = (1, i > 0, 0)
                else:
                    score = max([fuzz.ratio(joined, " ".join(tokens))] +
                                [fuzz.ratio(joined, t) for t in tokens if len(query) == 1])
                    if score < FUZZY_MIN:
                        continue
                    rank = (2, i > 0, -score)
                best = rank if best is None else min(best, rank)
            if best is not None:
                # city streets before villages, shorter names (closer to the query) first
                ranked.append((best, e["locality"] is not None, len(e["name"]), e["name"], e))
        ranked.sort(key=lambda r: r[:4])
        results = []
        for *_, e in ranked:
            place = e["locality"] or "Чернівці"
            for i, (lon, lat) in enumerate(e["parts"]):
                part = f", частина {i + 1} з {len(e['parts'])}" if len(e["parts"]) > 1 else ""
                results.append({"name": e["name"], "place": place + part, "lat": round(lat, 6), "lon": round(lon, 6)})
                if len(results) == limit:
                    return results
        return results


def load(path):
    return StreetIndex(json.loads(path.read_text(encoding="utf-8")))
