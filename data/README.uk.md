[English](README.md) | Українська

# Датасет

- **Джерело:** [road-damage-det](https://universe.roboflow.com/baka-1ravj/road-damage-det) на Roboflow Universe, автор baka
- **Ліцензія:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Обсяг:** 3 912 фото, спліт 70 / 20 / 10 (train / val / test)

Самі зображення в репозиторій не входять (папка `datasets/` у `.gitignore`).

## Класи

У вихідному датасеті було 7 класів. Ми звели їх у 3:

| Вихідний клас | → Клас Road Ledger |
|---|---|
| alligator cracking, edge cracking, longitudinal cracking, transverse cracking | **crack** |
| patching | **patching** |
| pothole | **pothole** |
| rutting (колійність) | прибрано |

## Відтворення датасету

Модель тренувалась на форку оригінального датасету з такими налаштуваннями в Roboflow:

- **Класи:** 4 класи тріщин об'єднано в `crack`; `rutting` видалено; `pothole` і `patching` без змін
- **Спліт:** 70 / 20 / 10 (train / val / test)
- **Препроцесинг:** Auto-Orient, Resize 640×640 (stretch)
- **Аугментації:** без аугментацій

Блокнот тренування завантажує цей форк із Roboflow-воркспейсу автора, тож з вашим API-ключем він напряму не запрацює. Щоб відтворити:

1. Зробіть fork [оригінального датасету](https://universe.roboflow.com/baka-1ravj/road-damage-det) у свій воркспейс Roboflow.
2. Застосуйте об'єднання класів і налаштування вище, згенеруйте версію датасету.
3. У [`model/notebooks/train.ipynb`](../model/notebooks/train.ipynb) замініть воркспейс, проєкт і версію на свої та задайте `ROBOFLOW_API_KEY`.

---

[English](README.md) | Українська
