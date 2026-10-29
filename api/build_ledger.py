"""Build api/data/contracts.json from _import/road_ledger_verified.xlsx (sheet «Договори»).

Usage: python api/build_ledger.py [path/to/road_ledger_verified.xlsx]
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

import openpyxl

from streets import street_keys, locality

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "_import" / "road_ledger_verified.xlsx"
OUT = Path(__file__).resolve().parent / "data" / "contracts.json"
SHEET = "Договори"
EXCLUDED_WORK_TYPES = {"інше"}


def find_header(rows):
    for i, row in enumerate(rows):
        if "street_verified" in row and "Номер договору" in row:
            return i
    raise SystemExit("header row with 'street_verified' not found")


def iso(value):
    if isinstance(value, (dt.datetime, dt.date)):
        return value.date().isoformat() if isinstance(value, dt.datetime) else value.isoformat()
    return value or None


def street_name(street_verified):
    # «вул. Карпатська — «Капітальний ремонт вул. Карпатської» (назва тендеру)»: the verified name is before « — »
    if not street_verified:
        return None
    return street_verified.split(" — ")[0].strip()


def warranty_source(row):
    """signed_contract: text of the signed contract;
    contract_attachment: draft-contract form from the tender docs, uploaded to the contract
      («гарантія з файлу «Додаток 5 до ТД …», завантаженого до договору (форма проєкту договору з ТД)»);
    tender_draft: draft contract in the tender documentation."""
    if row["warranty_months_verified"] is None:
        return "none"
    note = row["note"] or ""
    if "підписаного договору" in note:
        return "signed_contract"
    # checked before tender_draft: this note also contains «проєкту договору»
    if "завантаженого до договору" in note:
        return "contract_attachment"
    if "проєкту договору" in note:
        return "tender_draft"
    return None


# «Савков А. Л. (ФОП)»: sole proprietors are natural persons, so the full name is not published
FOP_SHORT_RE = re.compile(r"^[А-ЯІЇЄҐ][а-яіїєґ'’-]+ [А-ЯІЇЄҐ]\. [А-ЯІЇЄҐ]\. \(ФОП\)$")


def contractor_names(row):
    """(contractor, contractor_full); for a ФОП both are the short «Прізвище І. Б. (ФОП)»."""
    short, full = row["Підрядник (скорочено)"], row["Підрядник (повна назва)"]
    if not ((short or "").endswith("(ФОП)") or "ФОП" in (full or "").upper()):
        return short, full
    if not FOP_SHORT_RE.match(short or ""):
        raise SystemExit(f"ФОП without a short name «Прізвище І. Б. (ФОП)»: {row['Номер договору']}")
    return short, short


def tender_id(contract_id):
    # Prozorro contract IDs are the tender ID plus a lot/contract suffix: UA-2023-03-24-000603-a-b1
    return re.sub(r"-[a-z]\d+$", "", contract_id)


def build(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    rows = list(wb[SHEET].iter_rows(values_only=True))
    h = find_header(rows)
    header = rows[h]
    contracts = []
    for values in rows[h + 1:]:
        row = dict(zip(header, values))
        if not row["Номер договору"]:
            continue
        if row["work_type"] in EXCLUDED_WORK_TYPES:
            continue
        street = street_name(row["street_verified"])
        keys = street_keys(street)
        tid = tender_id(row["Номер договору"])
        contractor, contractor_full = contractor_names(row)
        contracts.append({
            "id": tid,
            "contract_id": row["Номер договору"],
            "street": street,
            "street_key": keys[0] if keys else None,
            "street_keys": keys,
            "locality": locality(street),
            "contractor": contractor,
            "contractor_full": contractor_full,
            "amount": row["Сума, грн"],
            "work_type": row["work_type"],
            "title": row["Назва / що ремонтували"],
            "warranty_months": row["warranty_months_verified"],
            "warranty_until": iso(row["warranty_until_estimate"]),
            "warranty_source": warranty_source(row),
            "status_check": row["status_check"],
            "warranty_quote": row["warranty_quote"],
            "source_url": row["warranty_source_url"],
            "tender_url": f"https://prozorro.gov.ua/tender/{tid}",
            "procurement_method": row["procurement_method"],
        })
    return contracts


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else XLSX
    contracts = build(xlsx)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(contracts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    streets = {k for c in contracts for k in c["street_keys"]}
    print(f"{len(contracts)} contracts, {len(streets)} unique street keys -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
