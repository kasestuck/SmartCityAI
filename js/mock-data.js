/*
 * MOCK. Ответы API в точности по контракту docs/api-contract.md — для работы без бекенда.
 * coffee / walk / tourist — копии настоящих ответов бекенда из docs/demo-results.json
 * (реальные POI OpenStreetMap, шаблонные объяснения). family собран из тех же POI,
 * объяснения в нём написаны вручную для демо. Эти данные не попадают в рабочую базу.
 */
(function () {
  "use strict";

  const RESPONSES = {
    coffee: {
      recommendations: [
        {
          id: "osm_node_12990081501",
          name: "Discovery Coffee",
          latitude: 51.0906396,
          longitude: 71.4260369,
          category: "cafe",
          description: null,
          reason: "Категория: кафе. Примерно 428 м по прямой; дорога к месту и посещение — около 28 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 427.57956693429014,
          estimated_duration_minutes: 28,
          suggested_action: "Рассмотреть кафе для короткого отдыха; перед визитом уточнить часы и условия.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_node_13173517356",
          name: "Gasteria",
          latitude: 51.0889451,
          longitude: 71.4093464,
          category: "cafe",
          description: null,
          reason: "Категория: кафе. Примерно 753 м по прямой; дорога к месту и посещение — около 34 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 753.2610927969778,
          estimated_duration_minutes: 34,
          suggested_action: "Рассмотреть кафе для короткого отдыха; перед визитом уточнить часы и условия.",
          opening_hours: "Mo-Th 10:00-23:00; Fr-Su 10:00-00:00",
          source: "OpenStreetMap",
        },
        {
          id: "osm_node_9047331879",
          name: "Starbucks",
          latitude: 51.0890092,
          longitude: 71.4089158,
          category: "cafe",
          description: null,
          reason: "Категория: кафе. Примерно 782 м по прямой; дорога к месту и посещение — около 34 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 781.9457437594187,
          estimated_duration_minutes: 34,
          suggested_action: "Рассмотреть кафе для короткого отдыха; перед визитом уточнить часы и условия.",
          opening_hours: "Mo-Su 08:00-22:00",
          source: "OpenStreetMap",
        },
      ],
    },

    walk: {
      recommendations: [
        {
          id: "osm_way_1460763574",
          name: "Тәуелсіздіктің 25 жылдығы",
          latitude: 51.0934524,
          longitude: 71.4175645,
          category: "attraction",
          description: null,
          reason: "Категория: достопримечательность. Примерно 420 м по прямой; дорога к месту и посещение — около 28 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 419.88445606651896,
          estimated_duration_minutes: 28,
          suggested_action: "Рассмотреть осмотр достопримечательности; заранее уточнить условия посещения.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_way_1456208624",
          name: "Бейбітшілік пен Келісім аллеясы",
          latitude: 51.0938123,
          longitude: 71.4169498,
          category: "park",
          description: null,
          reason: "Категория: парк. Примерно 474 м по прямой; дорога к месту и посещение — около 29 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 474.4229357416337,
          estimated_duration_minutes: 29,
          suggested_action: "Запланировать короткую прогулку; условия на месте заранее не проверены.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_way_1467797207",
          name: "NU Park",
          latitude: 51.0872699,
          longitude: 71.3994394,
          category: "park",
          description: null,
          reason: "Категория: парк. Примерно 1468 м по прямой; дорога к месту и посещение — около 46 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 1467.762441480902,
          estimated_duration_minutes: 46,
          suggested_action: "Запланировать короткую прогулку; условия на месте заранее не проверены.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
      ],
    },

    family: {
      recommendations: [
        {
          id: "osm_way_1456208624",
          name: "Бейбітшілік пен Келісім аллеясы",
          latitude: 51.0938123,
          longitude: 71.4169498,
          category: "park",
          description: null,
          reason: "Спокойная аллея недалеко от старта: можно гулять в своём темпе и делать остановки с детьми.",
          distance_meters: 474.4229357416337,
          estimated_duration_minutes: 29,
          suggested_action: "Пройтись по аллее всей семьёй и выбрать место для отдыха.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_way_1467797207",
          name: "NU Park",
          latitude: 51.0872699,
          longitude: 71.3994394,
          category: "park",
          description: null,
          reason: "Большой парк для неспешной прогулки, если есть пара часов и хочется больше простора.",
          distance_meters: 1467.762441480902,
          estimated_duration_minutes: 46,
          suggested_action: "Погулять по парку; условия на месте заранее не проверены.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_way_963855443",
          name: "Назарбаев орталығы-2",
          latitude: 51.1146527,
          longitude: 71.4421493,
          category: "museum",
          description: null,
          reason: "Музей подойдёт, если хочется добавить к прогулке что-то познавательное.",
          distance_meters: 3147.419520188372,
          estimated_duration_minutes: 100,
          suggested_action: "Рассмотреть посещение музея; заранее уточнить часы, билеты и условия.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
      ],
    },

    tourist: {
      recommendations: [
        {
          id: "osm_way_1460763574",
          name: "Тәуелсіздіктің 25 жылдығы",
          latitude: 51.0934524,
          longitude: 71.4175645,
          category: "attraction",
          description: null,
          reason: "Категория: достопримечательность. Примерно 420 м по прямой; дорога к месту и посещение — около 28 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 419.88445606651896,
          estimated_duration_minutes: 28,
          suggested_action: "Рассмотреть осмотр достопримечательности; заранее уточнить условия посещения.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_way_549307755",
          name: "Мәңгілік Ел салтанат қақпасы",
          latitude: 51.1043034,
          longitude: 71.4300836,
          category: "attraction",
          description: null,
          reason: "Категория: достопримечательность. Примерно 1739 м по прямой; дорога к месту и посещение — около 51 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 1739.369871839286,
          estimated_duration_minutes: 51,
          suggested_action: "Рассмотреть осмотр достопримечательности; заранее уточнить условия посещения.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
        {
          id: "osm_way_963855443",
          name: "Назарбаев орталығы-2",
          latitude: 51.1146527,
          longitude: 71.4421493,
          category: "museum",
          description: null,
          reason: "Категория: музей. Примерно 3147 м по прямой; дорога к месту и посещение — около 100 мин. Соответствие остальным пожеланиям не подтверждено; часы и условия нужно уточнить.",
          distance_meters: 3147.419520188372,
          estimated_duration_minutes: 100,
          suggested_action: "Рассмотреть посещение музея; заранее уточнить часы, билеты и условия.",
          opening_hours: null,
          source: "OpenStreetMap",
        },
      ],
    },

    empty: { recommendations: [] },
  };

  // Тела ошибок в формате контракта (тексты как в backend/errors.py).
  const ERRORS = {
    422: { error: { code: "VALIDATION_ERROR", message: "Некорректные параметры запроса" } },
    429: { error: { code: "RATE_LIMITED", message: "Слишком много запросов" } },
    500: { error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } },
    503: { error: { code: "AI_UNAVAILABLE", message: "AI-сервис временно недоступен" } },
  };

  function pickResponse(payload) {
    const cats = Array.isArray(payload.categories) ? payload.categories : [];
    const has = (c) => cats.includes(c);
    if (cats.length) {
      if (has("cafe")) return "coffee";
      if (has("playground") || (has("park") && has("museum"))) return "family";
      if (has("park")) return "walk";
      if (has("museum") || has("attraction") || has("viewpoint")) return "tourist";
      return "empty";
    }
    const q = String(payload.query || "").toLowerCase();
    if (/коф|каф/.test(q)) return "coffee";
    if (/сем|дет|ребён|ребен/.test(q)) return "family";
    if (/прогул|парк|погул/.test(q)) return "walk";
    return "tourist";
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }
    });
  }

  // Подменяет fetch: те же Response и коды, что у настоящего бекенда.
  async function mockFetch(url, init = {}) {
    const scenario = window.APP_CONFIG.MOCK_SCENARIO || "ok";
    const path = new URL(url, window.location.href).pathname;
    const signal = init.signal;

    if (path.endsWith("/api/health")) {
      await delay(150, signal);
      return json(200, { status: "ok" });
    }

    if (scenario === "timeout") {
      // Никогда не отвечает: сработает таймаут клиента.
      await delay(10 * 60 * 1000, signal);
    }
    await delay(window.APP_CONFIG.MOCK_DELAY_MS, signal);

    switch (scenario) {
      case "network":
        throw new TypeError("Failed to fetch");
      case "empty":
        return json(200, RESPONSES.empty);
      case "422":
        return json(422, ERRORS[422]);
      case "429":
        return json(429, ERRORS[429]);
      case "500":
        return json(500, ERRORS[500]);
      case "503-empty":
        return json(503, ERRORS[503]);
      case "html":
        return new Response("<html><body><h1>502 Bad Gateway</h1>nginx</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        });
      default: {
        const payload = JSON.parse(init.body || "{}");
        const body = RESPONSES[pickResponse(payload)];
        // 503 с данными: места есть, объяснения шаблонные.
        return json(scenario === "503" ? 503 : 200, body);
      }
    }
  }

  window.MOCK = Object.freeze({ RESPONSES, ERRORS, fetch: mockFetch });
})();
