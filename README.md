# 🏃 Неон-ран

**Бесконечный раннер в неоновом synthwave-городе.**

### ▶️ [Играть](https://mmmaksmog-commits.github.io/neon-run/)

Работает на телефоне и на ПК, без установки и регистрации.

## Возможности

- Прыжок и двойной прыжок — тап, пробел или стрелка вверх
- Три типа препятствий: шипы, блоки и летающие дроны
- Скорость растёт со временем, кристаллы дают бонусные очки
- Параллакс-город, ретро-сетка, частицы и тряска камеры
- Звуки на Web Audio API без аудиофайлов
- Рекорд сохраняется, адаптивная камера для вертикальных экранов

## Стек

Canvas 2D, requestAnimationFrame, Web Audio API, Pointer Events. Без фреймворков и сборки.

## Запуск локально

```bash
git clone https://github.com/mmmaksmog-commits/neon-run.git
cd neon-run
python3 -m http.server 8000
```

Затем откройте http://localhost:8000.

---

Часть [портфолио](https://mmmaksmog-commits.github.io/).
