# Датасет

- **Джерело:** Roboflow Universe, [ВСТАВ URL ДАТАСЕТУ]
- **Ліцензія:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Обсяг:** 3 912 фото, спліт 70 / 20 / 10 (train / val / test)
- **Препроцесинг:** Auto-Orient, Resize 640, без аугментацій

Самі зображення в репозиторій не входять (папка `datasets/` у `.gitignore`). Їх завантажує блокнот тренування через Roboflow API, ключ береться зі змінної середовища `ROBOFLOW_API_KEY`.

## Класи

У вихідному датасеті було 7 класів. Для нашої задачі ми звели їх у 3:

| Вихідний клас | → Клас Road Ledger |
|---|---|
| 4 типи тріщин | **crack** |
| patching | **patching** |
| pothole | **pothole** |
| rutting (колійність) | прибрано |
