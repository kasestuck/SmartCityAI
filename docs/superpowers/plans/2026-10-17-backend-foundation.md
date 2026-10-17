# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Поставить часть 2: запускаемый FastAPI с SQLite, строгим контрактом, безопасными ошибками и health.

**Architecture:** Factory `create_app(settings: Settings | None = None) -> FastAPI` создаёт приложение; lifespan инициализирует SQLite. Соединение создаётся на операцию и закрывается в том же потоке. Рекомендации в этой части возвращают `[]` после проверки запроса и доступности таблицы.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic 2, pydantic-settings, sqlite3, Uvicorn, pytest, HTTPX2.

**Spec:** `docs/backend-design.md`, часть 2; `docs/api-contract.md`. Архитектура одобрена пользователем; реализация части 2 явно запрошена 17 октября 2026.

## Global Constraints

- `GET /api/health -> {"status":"ok"}`; проверка доступности таблицы POI без Gemini.
- `POST /api/recommendations`; точные поля из контракта, 0–3 результата.
- latitude [-90,90], longitude [-180,180], query 1–500 после strip, duration_minutes integer 15–240, transport только walking, categories необязательный список строк.
- Булевы значения и строки не заменяют числа; NaN/Infinity, дробная длительность, лишние поля и пустой запрос отклоняются.
- Ошибки 422 VALIDATION_ERROR и 500 INTERNAL_ERROR имеют `error.code` и `error.message` без тела запроса и внутренних исключений.
- Никаких выдуманных POI, сети, ключа Gemini или хранения пользовательских запросов.
- CORS origins задаются настройками; CORS сохраняется на ошибочных ответах.

## Review Focus

- База исчезла после старта: health возвращает JSON 500, не создаёт новую пустую базу.
- CORS на неожиданном исключении: разрешённый frontend получает читаемый JSON 500.
- Строки, bool и нечисловые JSON-числа не проходят преобразование в координаты/время.
- Повторный startup сохраняет POI и не дублирует таблицы.
- Локальный `.env` читается независимо от cwd, но переменные процесса имеют приоритет.

## Task 1: SQLite и конфигурация

**Files:** `backend/config.py`, `backend/database/__init__.py`, `backend/database/db.py`, `backend/database/models.py`, `backend/tests/test_database.py`, `backend/tests/test_config.py`.

**Interfaces:**
- `Settings` (BaseSettings): `database_path: Path`, `cors_origins: list[str]`. `.env` по умолчанию `backend/.env`; относительная database_path относительно backend; `_env_file=None` отключает dotenv в тестах. Defaults: backend/data/poi.sqlite3 и [http://localhost:5173]. Имена окружения DATABASE_PATH и CORS_ORIGINS (JSON array). Extra env игнорируются.
- `Database(path: Path)`: `initialize() -> None`, `check_health() -> None`, `connection(*, readonly: bool = False)` — context manager sqlite3.Connection. initialize создаёт каталог и таблицу; readonly не создаёт файл. Проверка health читает таблицу poi. Ошибки sqlite не маскируются в слое БД.
- `POI`: frozen dataclass с полями из backend ТЗ. Операции записи/upsert откладываются до части 3; для DB-тестов используется SQL во временных базах.

- [x] Сначала тесты: новая БД пуста; данные переживают initialize; уникальность OSM-пары; ограничения координат; транзакция rollback при исключении; readonly/health не создают исчезнувший файл; env overrides и относительные пути.
- [x] Запустить `.venv/Scripts/python -m pytest backend/tests/test_database.py backend/tests/test_config.py -q`, увидеть ожидаемое отсутствие реализации.
- [x] Реализовать конфигурацию и БД. SQL параметризован; metadata соответствует ТЗ; индексы географии и категории.
- [x] Повторить тесты, проверить успешный результат.

## Task 2: API и схемы

**Files:** `backend/__init__.py`, `backend/schemas.py`, `backend/errors.py`, `backend/main.py`, `backend/routes/__init__.py`, `backend/routes/health.py`, `backend/routes/recommendations.py`, `backend/tests/test_api.py`.

**Interfaces:** consumes Settings и Database из Task 1. Produces `create_app(settings=None) -> FastAPI`, `app`, Pydantic `RecommendationRequest`, `Recommendation`, `RecommendationsResponse`, `HealthResponse`, `ErrorResponse`. Database доступна как `app.state.database`; Settings как `app.state.settings`.

- [x] Написать тесты health 200, пустая выдача 200, границы и недопустимые типы 422, JSON-синтаксис, обязательные поля, отсутствующие/пустые/неизвестные категории.
- [x] Запустить API-тесты до реализации, убедиться в ожидаемой причине отказа.
- [x] Реализовать схемы, роутеры, lifespan и обработчики. Для 404/405 — JSON с NOT_FOUND/METHOD_NOT_ALLOWED. Для 429/503 — зарезервированные коды контракта; rate limiter не внедрять.
- [x] Проверить реальные сбои SQLite и неожиданные исключения с TestClient(raise_server_exceptions=False), безопасное тело и CORS на 500; OpenAPI и `/docs` доступны.
- [x] Весь pytest suite и Ruff проходят.

## Task 3: Инструкции и сквозная проверка

**Files:** `backend/.env.example`, `backend/README.md`, root `README.md`, `backend/requirements-lock.txt`.

- [x] Зафиксировать реально установленные версии, описать Windows PowerShell и Linux запуск, dotenv, CORS и пределы части 2.
- [x] Запустить весь pytest suite, Ruff и pip check.
- [x] Запустить Uvicorn с временной SQLite, выполнить реальные HTTP GET health и POST recommendations, затем остановить процесс.
- [x] Свежий независимый обзор кода; исправить существенные находки с регрессионной проверкой.

## Рабочие решения

Реализация выполняется в текущей папке: репозиторий новый, без коммитов и без чужого кода; перенос в worktree не нужен для этой части. Git commit/push и публикация не входят в поставку. Инструкции планирования не создают повторный запрос разрешения: пользователь уже явно поручил реализацию части 2.
