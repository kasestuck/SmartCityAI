/*
 * Единственное место с настройками фронтенда.
 * Секретов здесь нет и быть не должно: ключ Gemini живёт только на бекенде.
 */
(function () {
  "use strict";

  // Адрес бекенда (FastAPI). Меняется только здесь.
  const API_BASE_URL = "http://localhost:8000";

  // true — работать на js/mock-data.js без бекенда.
  // Можно не править файл: ?mock=1 в адресе страницы включает mock,
  // ?mock=<сценарий> включает конкретный mock-ответ (см. README).
  const USE_MOCK = false;

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

    REQUEST_TIMEOUT_MS: 15000,
    HEALTH_TIMEOUT_MS: 5000,
    RATE_LIMIT_COOLDOWN_S: 60,

    MAX_RESULTS: 3,
    QUERY_MAX_LENGTH: 500,
    TRANSPORT: "walking",
    DURATIONS: Object.freeze([15, 30, 60, 90, 120, 180, 240]),
    DEFAULT_DURATION: 60,

    // Категории MVP из docs/api-contract.md.
    CATEGORIES: Object.freeze([
      { value: "cafe", label: "Кафе", chip: "Кофе", emoji: "☕" },
      { value: "restaurant", label: "Ресторан", chip: "Рестораны", emoji: "🍽️" },
      { value: "park", label: "Парк", chip: "Парки", emoji: "🌳" },
      { value: "museum", label: "Музей", chip: "Музеи", emoji: "🏛️" },
      { value: "attraction", label: "Достопримечательность", chip: "Достопримечательности", emoji: "📍" },
      { value: "viewpoint", label: "Смотровая площадка", chip: "Виды", emoji: "🔭" },
      { value: "playground", label: "Детская площадка", chip: "Детские площадки", emoji: "🛝" },
    ]),

    // Явно подписанный вариант «Центр Астаны» — не координаты пользователя.
    ASTANA_CENTER: Object.freeze({ lat: 51.1605, lon: 71.4704 }),

    // Сценарии для демо (раздел 6 ТЗ) + пара быстрых идей из макета.
    SCENARIOS: Object.freeze([
      { id: "walk", label: "🌿 Короткая прогулка", query: "Хочу короткую прогулку", duration: 30, categories: ["park"] },
      { id: "coffee", label: "☕ Кофе рядом", query: "Кофе рядом", duration: 15, categories: ["cafe"] },
      { id: "family", label: "👨‍👩‍👧 С семьёй", query: "Куда сходить с семьёй", duration: 120, categories: ["park", "playground", "museum"] },
      { id: "culture", label: "🎨 Культура", query: "Хочу посмотреть что-нибудь интересное в городе", duration: 90, categories: ["museum", "attraction"] },
      { id: "views", label: "✨ Что-то необычное", query: "Хочу красивые виды и что-то необычное", duration: 60, categories: ["viewpoint", "attraction"] },
    ]),

    OSM_COPYRIGHT_URL: "https://www.openstreetmap.org/copyright",
  });
})();
