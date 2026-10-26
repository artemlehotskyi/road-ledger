English | [Українська](README.uk.md)

# Dataset

- **Source:** [road-damage-det](https://universe.roboflow.com/baka-1ravj/road-damage-det) on Roboflow Universe, by baka
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Size:** 3,912 images, 70 / 20 / 10 split (train / val / test)

The images are not stored in this repository (`datasets/` is in `.gitignore`).

## Classes

The source dataset has 7 classes. We merged them into 3:

| Source class | → Road Ledger class |
|---|---|
| alligator cracking, edge cracking, longitudinal cracking, transverse cracking | **crack** |
| patching | **patching** |
| pothole | **pothole** |
| rutting | removed |

## Reproducing the dataset

The model was trained on a fork of the original dataset with these settings applied in Roboflow:

- **Classes:** the 4 cracking classes merged into `crack`; `rutting` removed; `pothole` and `patching` unchanged
- **Split:** 70 / 20 / 10 (train / val / test)
- **Preprocessing:** Auto-Orient, Resize to 640×640 (stretch)
- **Augmentation:** none

The training notebook downloads that fork from the author's own Roboflow workspace, so it won't work as-is with your API key. To reproduce:

1. Fork [the original dataset](https://universe.roboflow.com/baka-1ravj/road-damage-det) into your Roboflow workspace.
2. Apply the class merge and the settings above, then generate a dataset version.
3. In [`model/notebooks/train.ipynb`](../model/notebooks/train.ipynb), replace the workspace, project, and version with your own, and set `ROBOFLOW_API_KEY`.

---

English | [Українська](README.uk.md)
