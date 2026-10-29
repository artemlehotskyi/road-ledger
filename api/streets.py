"""Street-name normalization shared by build_ledger.py and main.py."""
import json
import re

# Street-type words, full and abbreviated. OSM puts them after the name («Хотинська вулиця»),
# the ledger before it («вул. Хотинська»), so they are removed wherever they occur.
STREET_TYPES = [
    "вулиця", "вулиці", "вул", "проспект", "просп", "провулок", "пров", "бульвар", "бульв",
    "площа", "пл", "узвіз", "проїзд", "шосе", "набережна", "тупик", "алея",
]
_TYPES_RE = re.compile(r"(?<![\w])(?:" + "|".join(STREET_TYPES) + r")\.?(?![\w])")
_QUOTES_RE = re.compile(r"[’'`ʼ\"«»“”„]")
_PAREN_RE = re.compile(r"\(([^)]*)\)")
_INITIAL_RE = re.compile(r"^(\w)\.\s*")


def street_key(name):
    """«вул. Д. Лукіяновича, 12» -> «д. лукіяновича»; «Хотинська вулиця» -> «хотинська»."""
    if not name:
        return None
    s = name.lower().replace("ё", "е")
    s = _PAREN_RE.sub(" ", s)          # «(с. Коровія)» is a locality, kept separately
    s = s.split(",")[0]                # house numbers come after the first comma
    s = _QUOTES_RE.sub("", s)
    s = _TYPES_RE.sub(" ", s)
    s = re.sub(r"\s+\d[\w\-–/]*\s*$", "", s)  # trailing house number without a comma («Комарова 2А»)
    s = re.sub(r"\s*-\s*", "-", s)     # «Південно - Кільцева» -> «південно-кільцева»
    s = re.sub(r"\s+", " ", s).strip(" .-")
    return s or None


def street_keys(name):
    """All street keys mentioned in a ledger street field (crossings and «A / B» list several)."""
    if not name:
        return []
    text = _PAREN_RE.sub(" ", name)
    text = re.sub(r"^\s*перехрестя\s+", "", text, flags=re.I)
    parts = re.split(r"\s*/\s*|,\s*(?=(?:вул|пров|просп|бульв)\.?\s)|\s+та\s+", text)
    keys = []
    for part in parts:
        key = street_key(part)
        if key and re.search(r"[^\W\d]{2,}", key) and key not in keys:
            keys.append(key)
    return keys


def locality(name):
    """«вул. Довбуша (с. Коровія)» -> «Коровія»."""
    m = _PAREN_RE.search(name or "")
    if m and re.match(r"\s*(с|смт|м)\.\s*", m.group(1)):
        return re.sub(r"^\s*(с|смт|м)\.\s*", "", m.group(1)).strip()
    return None


def keys_match(ledger_key, osm_key):
    """Exact match, or initials in the ledger match full first names in OSM:
    «д. лукіяновича» ~ «дениса лукіяновича». «о. масикевич» ~ «ореста масикевича» is NOT matched here
    (different form); such pairs and renamed streets go to data/street_aliases.json."""
    if not ledger_key or not osm_key:
        return False
    if ledger_key == osm_key:
        return True
    lt, ot = ledger_key.split(), osm_key.split()
    if len(lt) != len(ot):
        return False
    for a, b in zip(lt, ot):
        m = _INITIAL_RE.match(a)
        if m and len(a) <= 2:
            if not b.startswith(m.group(1)):
                return False
        elif a != b:
            return False
    return True


def load_aliases(path):
    """data/street_aliases.json -> {(locality, osm_key): [alias, ...]}; osm_key is street_key(osm_name)."""
    aliases = {}
    for a in json.loads(path.read_text(encoding="utf-8"))["aliases"]:
        aliases.setdefault((a["locality"], street_key(a["osm_name"])), []).append(a)
    return aliases
