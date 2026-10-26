<p align="center">
  <img src="assets/brand/banner.png" alt="Road Ledger: every road repair has a history and a warranty" width="100%">
</p>

<p align="center">English | <a href="README.uk.md">Українська</a></p>

<p align="center">
  <b>Photo of a pothole → defect → Prozorro contract → is the contractor's warranty still active?</b><br>
  Chernivtsi Open Data Hackathon 3.0
</p>

---

## The problem

Streets in Chernivtsi get repaired, and a year or two later the same spots are covered in potholes and cracks again. Contractors usually give a warranty on their work, but nobody remembers it. So the city pays for the same repair twice instead of making the contractor fix it under warranty.

**A real case: Karmeliuka Street, Chernivtsi.** The street went through a major overhaul in 2020–2021 that cost over UAH 47 million and came with a 10-year warranty. In 2024 the manholes started sinking. The contractor did not do the warranty work, so a municipal company fixed it, paid for from the city budget. ([Suspilne Chernivtsi, July 2024](https://suspilne.media/chernivtsi/802107-dilanki-poblizu-lukiv-na-vulici-karmeluka-u-cernivcah-vidremontuvali-ne-za-garantieu-pisla-kapremontu-comu/))

The data to check this is already public: every road repair contract is in **Prozorro**, Ukraine's public procurement system. What's missing is a link between a specific pothole and a specific contract.

## How it works

A resident takes a photo of a defect, and Road Ledger tells them whether that stretch of road is still under warranty and who is responsible for it.

```
 Photo + geolocation
        │
        ▼
 ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ 1. Detection         │   │ 2. Contract ledger   │   │ 3. Matching          │
 │ YOLO11s finds        │──▶│ Prozorro: road       │──▶│ street + date +      │
 │ crack / patching /   │   │ repairs in Chernivtsi│   │ warranty period →    │
 │ pothole              │   │ streets, contractors,│   │ "under warranty      │
 │                      │   │ warranty periods     │   │  until …, by …"      │
 └──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

1. **Detection.** A computer vision model (YOLO11s) finds pavement defects in the photo and classifies them.
2. **Contract ledger.** Road repair contracts from Prozorro are collected into a table: street, completion date, contractor, warranty period.
3. **Matching.** The photo's geolocation gives the street; the system finds the latest repair there and shows whether the warranty is still active.

## Status

| Component | Status | Where |
|---|---|---|
| CV model (YOLO11s, 3 classes) | Trained, evaluated on test | [`model/`](model/) |
| Dataset | Prepared (Roboflow Universe) | [`data/`](data/) |
| Prozorro contract ledger | In progress | [`ledger/`](ledger/) |
| Photo ↔ contract matching | In progress | [`ledger/`](ledger/) |
| App (PWA) | In progress | [`app/`](app/) |

Test set results (391 images): **mAP50 = 0.784**, P = 0.808, R = 0.712. Details in [`model/README.md`](model/README.md).

## Repository layout

```
road-ledger/
├── README.md            ← you are here
├── requirements.txt     ← dependencies (ultralytics, roboflow)
├── assets/
│   └── brand/           ← logos and banner (SVG, PNG)
├── model/
│   ├── README.md        ← metrics, training setup, inference
│   ├── weights/
│   │   └── best.pt      ← trained YOLO11s weights
│   ├── notebooks/
│   │   └── train.ipynb  ← training notebook (Colab)
│   └── images/
│       ├── train/       ← training curves
│       └── test/        ← test set plots and predictions
├── data/
│   └── README.md        ← dataset source, license, classes, how to reproduce
├── ledger/
│   └── README.md        ← Prozorro contract ledger and matching (in progress)
└── app/
    └── README.md        ← PWA for residents (in progress)
```

Every README has a Ukrainian version next to it (`README.uk.md`).

## Quick start

```bash
pip install -r requirements.txt
```

See [`model/README.md`](model/README.md#inference) for how to run the model.

---

<p align="center">English | <a href="README.uk.md">Українська</a></p>
