# POI Search and RAG Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans; follow TDD and the interfaces below.

**Goal:** Реализовать сразу части 3–5 одобренного проекта: реальный сбор OSM, геопоиск и Gemini RAG с fallback.

**Architecture:** Отдельная CLI наполняет SQLite через Overpass; синхронный маршрут FastAPI выполняет SQL retrieval и Haversine, затем AI-объяснения либо шаблоны. JSON-контракт не меняется.

**Spec:** `docs/backend-design.md`, `docs/api-contract.md`.

**Tech Stack:** существующие FastAPI/Pydantic/sqlite3; стандартная библиотека Python для HTTP и Gemini REST API. Публичная публикация не входит в работу.

## Global Constraints

- Только реальные POI из SQLite; максимум 3 ответа; названия, координаты, описание, часы и source только из POI.
- Стабильный id `osm_<type>_<id>`; повторный сбор без дублей; поля без сведений остаются null.
- Пользовательские координаты и запросы не сохраняются и не логируются; координаты пользователя не отправляются Gemini.
- Не обещать доступность, часы, розетки, безопасность и события без данных. Gemini создаёт только reason/suggested_action.
- Ошибка Gemini или отсутствие ключа → HTTP 200 и шаблонные объяснения; пустой retrieval → [] без AI.
- Единицы и поля принятого контракта сохраняются; расстояние по прямой, пешее время — эвристика.

## Review Focus

- node/way/relation, отсутствие центра/названия, неверные координаты, повторные id и неполные теги.
- Повреждённый/просроченный кеш и ответы Overpass с remark; retry 429/5xx, дата исходных данных.
- Полюса и линия смены дат, жёсткие категории, время и детерминированное ранжирование.
- Неизвестные/повторные id Gemini, повреждённый JSON, инъекции в query/POI, неподтверждённые факты.
- Сетевая ошибка не стирает базу; ошибка AI не скрывает ошибку SQLite; секрет не появляется в логах.

## Task 1: Коллектор и сохранение

**Files:** `backend/services/poi_collector.py`, `backend/scripts/collect_poi.py`, `backend/database/db.py`, `backend/tests/test_collector.py`.

**Interfaces:** `Database.upsert_pois(pois: Iterable[POI]) -> int`; `collect_poi(settings: Settings, database: Database, *, force: bool = False) -> CollectionResult`. Result fields: received, saved, skipped, from_cache, collected_at. CLI `python -m backend.scripts.collect_poi [--force]`, также прямой запуск файла.

- [x] Сначала тесты нормализации, upsert, HTTP retry/timeout, кеша и CLI ошибки; увидеть RED.
- [x] Реализовать nwr-сбор Астаны через Overpass, ограничения повторов, TTL и атрибуцию.
- [x] Сохранение параметризованное и транзакционное. Неполный или ошибочный ответ не подменяет успешный кеш.
- [x] GREEN профильных тестов; проверить повторный настоящий сбор при доступной сети.

## Task 2: Геопоиск

**Files:** `backend/services/geo_search.py`, `backend/tests/test_geo_search.py`.

**Interfaces:** frozen `Candidate(poi: POI, distance_meters: float, estimated_duration_minutes: int, score: float)`; `search_poi(database: Database, request: RecommendationRequest, limit: int = 12) -> list[Candidate]`; `haversine_meters(lat1, lon1, lat2, lon2) -> float`.

- [x] RED тестов расстояния, bbox/dateline/poles, категорий, бюджета, скоринга, стабильного top-N и пустой базы.
- [x] SQL bbox и категории → Haversine → время → скоринг 0.5 category + 0.3 text + 0.2 proximity.
- [x] Скорость 75 м/мин, запас 1.3; посещение cafe20, restaurant45, park20, museum45, attraction20, viewpoint10, playground20. Один путь к месту; рекомендации — альтернативы.
- [x] GREEN профильных тестов.

## Task 3: Gemini и RAG

**Files:** `backend/services/gemini.py`, `backend/services/rag.py`, `backend/tests/test_rag.py`, `backend/tests/test_gemini.py`.

**Interfaces:** `GeminiClient(settings: Settings).generate(request: RecommendationRequest, candidates: list[Candidate]) -> object`; `build_recommendations(request, candidates, generator: GeminiClient | None = None) -> RecommendationsResponse`. Сырой результат модели: object с recommendations array из {id, reason, suggested_action}; проверка каждого элемента в RAG. Неизвестные поля/ids не принимаются.

- [x] RED тестов валидной генерации, неизвестных/повторных ids, malformed JSON, partial/fallback, отсутствия утечки координат и ключа.
- [x] Реализовать Gemini REST с JSON-schema, настраиваемой моделью, таймаутом и без автоматических повторов AI.
- [x] Сборка карточек только из Candidate; вывод максимум 3 без дублей; при ошибке модели — шаблоны.
- [x] GREEN профильных тестов.

## Task 4: Настройки, API и документация

**Files:** root owns `backend/config.py`, `backend/main.py`, `backend/routes/recommendations.py`, env-example, README, дополнительные API-тесты, docs.

Settings additions (exact names): `overpass_url: str`, `overpass_bbox: tuple[float,float,float,float]` in south/west/north/east order, `overpass_timeout_seconds: float`, `overpass_attempts: int`, `overpass_retry_delay_seconds: float`, `poi_cache_path: Path`, `poi_cache_ttl_seconds: int`, `gemini_api_key: SecretStr`, `gemini_model: str`, `gemini_timeout_seconds: float`.

- [x] Добавить конфигурацию и её тесты; ключ скрыт SecretStr. Default bbox 50.95/71.20/51.30/71.75, TTL 86400, Overpass attempts3/timeout45/delay2; Gemini timeout8, default model из актуальной документации.
- [x] RED→GREEN сквозных API-тестов на временной SQLite и заменяемом Gemini; подключить search→RAG.
- [x] CLI фактически собирает реальные POI; повтор не создаёт дублей. Live API на собранной базе и 3 сценария.
- [x] Весь pytest, Ruff, pip check и независимое code review. Обновить инструкции и ограничения; настоящий Gemini проверяется только при наличии ключа.
