/*
 * Единственное место с настройками фронтенда.
 * Секретов здесь нет и быть не должно: ключ Gemini живёт только на бекенде.
 */
(function () {
  "use strict";

  // Адрес бекенда (FastAPI). Меняется только здесь.
  const API_BASE_URL = "http://localhost:8001";

  // true — работать на js/mock-data.js без бекенда.
  // Можно не править файл: ?mock=1 в адресе страницы включает mock,
  // ?mock=<сценарий> включает конкретный mock-ответ (см. README).
  const USE_MOCK = false;

  // API поддерживает language: ru/kk. Доступность пока есть только в ответе:
  // поле accessibility в реальном запросе не поддерживается и вызовет 422.
  // В mock-режиме критерии доступности включены для демонстрации.
  const BACKEND_SUPPORTS_ACCESSIBILITY = false;
  const BACKEND_SUPPORTS_LANGUAGE = true;
  // GET /api/poi — все места для слоя на экране «Карта». Пока нет — берём снимок OSM.
  const BACKEND_SUPPORTS_POI = false;

  const params = new URLSearchParams(window.location.search);
  const mockParam = params.get("mock");
  const MOCK_SCENARIOS = [
    "ok", "empty", "422", "429", "500", "503", "503-empty", "html", "network", "timeout",
  ];
  let mockScenario = null;
  if (mockParam !== null && mockParam !== "0") {
    mockScenario = MOCK_SCENARIOS.includes(mockParam) ? mockParam : "ok";
  } else if (USE_MOCK && mockParam !== "0") {
    mockScenario = "ok";
  }

  window.APP_CONFIG = Object.freeze({
    API_BASE_URL: API_BASE_URL.replace(/\/+$/, ""),
    USE_MOCK: mockScenario !== null,
    MOCK_SCENARIO: mockScenario,
    MOCK_SCENARIOS: Object.freeze(MOCK_SCENARIOS),
    MOCK_DELAY_MS: 700,
    FEATURES: Object.freeze({
      ACCESSIBILITY_FIELD: BACKEND_SUPPORTS_ACCESSIBILITY || mockScenario !== null,
      LANGUAGE_FIELD: BACKEND_SUPPORTS_LANGUAGE,
      POI_ENDPOINT: BACKEND_SUPPORTS_POI && mockScenario === null,
    }),

    REQUEST_TIMEOUT_MS: 15000,
    HEALTH_TIMEOUT_MS: 5000,
    RATE_LIMIT_COOLDOWN_S: 60,

    MAX_RESULTS: 3,
    QUERY_MAX_LENGTH: 500,
    TRANSPORT: "walking",
    DURATIONS: Object.freeze([15, 30, 60, 90, 120, 180, 240]),
    DEFAULT_DURATION: 60,

    // Категории MVP из docs/api-contract.md. Подписи — в js/i18n.js (cat_*, chip_*).
    CATEGORIES: Object.freeze([
      { value: "cafe", icon: "lc-coffee.svg" },
      { value: "restaurant", icon: "lc-utensils.svg" },
      { value: "park", icon: "lc-trees.svg" },
      { value: "museum", icon: "lc-landmark.svg" },
      { value: "attraction", icon: "lc-camera.svg" },
      { value: "viewpoint", icon: "lc-binoculars.svg" },
      { value: "playground", icon: "lc-baby.svg" },
    ]),

    // Особые потребности (предложение к контракту: docs/proposal-accessibility-language.md).
    ACCESSIBILITY_NEEDS: Object.freeze(["wheelchair", "low_mobility", "quiet"]),

    // Явно подписанный вариант «Центр Астаны» — не координаты пользователя.
    ASTANA_CENTER: Object.freeze({ lat: 51.1605, lon: 71.4704 }),

    // Быстрые идеи. Подпись и текст запроса — в js/i18n.js (sc_<id>, sc_<id>_q).
    SCENARIOS: Object.freeze([
      { id: "walk", icon: "lc-footprints.svg", duration: 30, categories: ["park"] },
      { id: "coffee", icon: "lc-coffee.svg", duration: 15, categories: ["cafe"] },
      { id: "family", icon: "lc-users.svg", duration: 120, categories: ["park", "playground", "museum"] },
      { id: "culture", icon: "lc-palette.svg", duration: 90, categories: ["museum", "attraction"] },
      { id: "views", icon: "sparkles-16.svg", duration: 60, categories: ["viewpoint", "attraction"] },
      { id: "dinner", icon: "lc-utensils.svg", duration: 90, categories: ["restaurant"] },
      { id: "kids", icon: "lc-baby.svg", duration: 60, categories: ["playground"] },
      { id: "evening", icon: "lc-moon.svg", duration: 90, categories: ["park", "viewpoint"] },
    ]),

    OSM_COPYRIGHT_URL: "https://www.openstreetmap.org/copyright",

    // Слой «все места» на экране «Карта».
    POI_SNAPSHOT_URL: "data/poi-astana.json",
    POI_LIMIT: 1000,
    AROUND_RADIUS_M: 1500,

    // Карта выбора точки: стартовый вид и ориентиры (координаты приблизительные).
    MAP_DEFAULT_CENTER: Object.freeze({ lat: 51.128, lon: 71.43 }),
    // Названия — в js/i18n.js (lm_<key>). Mega Silk Way и аэропорт — из сценариев кейса.
    LANDMARKS: Object.freeze([
      { key: "baiterek", lat: 51.1283, lon: 71.4305 },
      { key: "khan_shatyr", lat: 51.1323, lon: 71.4036 },
      { key: "akorda", lat: 51.1258, lon: 71.4466 },
      { key: "nurzhol", lat: 51.1252, lon: 71.4185 },
      { key: "botanical", lat: 51.1105, lon: 71.412 },
      { key: "expo", lat: 51.089, lon: 71.4155 },
      { key: "mega", lat: 51.0893, lon: 71.4093 },
      { key: "nu", lat: 51.0905, lon: 71.3985 },
      { key: "airport", lat: 51.0222, lon: 71.4669 },
    ]),

    // Виджеты главной (внешние сервисы без ключей, данные пользователя не передаются).
    WEATHER_POINT: Object.freeze({ lat: 51.1694, lon: 71.4491 }), // Астана
    WIDGET_TIMEOUT_MS: 8000,
    NEWS_TIMEOUT_MS: 20000, // GDELT бывает медленным
    NEWS_ATTEMPTS: 3,
    NEWS_COUNT: 5,
    NEWS_CACHE_MS: 20 * 60 * 1000,
    NEWS_MORE_URL: "https://news.google.com/search?q=%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0&hl=ru&gl=KZ&ceid=KZ%3Aru",
  });
})();
