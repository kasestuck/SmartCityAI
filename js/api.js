/*
 * Запросы к бекенду и разбор ошибок (docs/api-contract.md).
 * Сырые ответы сервера пользователю не показываются.
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;

  // kind: validation | rate_limited | internal | ai_unavailable | network | timeout | unknown
  class ApiError extends Error {
    constructor(kind, { status = 0, code = null, serverMessage = null, recommendations = null } = {}) {
      super(kind);
      this.name = "ApiError";
      this.kind = kind;
      this.status = status;
      this.code = code;
      this.serverMessage = serverMessage;
      this.recommendations = recommendations;
    }
  }

  function getFetch() {
    return CFG.USE_MOCK ? window.MOCK.fetch : window.fetch.bind(window);
  }

  async function send(path, { method = "GET", body, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await getFetch()(CFG.API_BASE_URL + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
    } catch (err) {
      throw new ApiError(err && err.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(response) {
    try {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null; // не JSON (например, HTML от прокси)
    }
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function localIllustration(category, value) {
    const icon = CFG.CATEGORIES.find((c) => c.value === category)?.icon || "lc-map-pin.svg";
    const path = "/assets/icons/" + icon;
    return value === path ? path : null;
  }

  // Оставляем только элементы, которые можно безопасно показать.
  function sanitizeRecommendations(list) {
    if (!Array.isArray(list)) return null;
    return list
      .filter((r) => isObject(r) && typeof r.name === "string" && r.name.trim() !== "")
      .slice(0, CFG.MAX_RESULTS)
      .map((r, i) => ({
        id: typeof r.id === "string" && r.id ? r.id : `place_${i + 1}`,
        name: r.name,
        latitude: isFiniteNumber(r.latitude) && Math.abs(r.latitude) <= 90 ? r.latitude : null,
        longitude: isFiniteNumber(r.longitude) && Math.abs(r.longitude) <= 180 ? r.longitude : null,
        category: typeof r.category === "string" ? r.category : null,
        image_url: localIllustration(r.category, r.image_url),
        description: typeof r.description === "string" ? r.description : null,
        reason: typeof r.reason === "string" ? r.reason : null,
        distance_meters: isFiniteNumber(r.distance_meters) && r.distance_meters >= 0 ? r.distance_meters : null,
        estimated_duration_minutes:
          isFiniteNumber(r.estimated_duration_minutes) && r.estimated_duration_minutes > 0
            ? Math.round(r.estimated_duration_minutes)
            : null,
        suggested_action: typeof r.suggested_action === "string" ? r.suggested_action : null,
        opening_hours: typeof r.opening_hours === "string" ? r.opening_hours : null,
        source: typeof r.source === "string" ? r.source : null,
        status_note: typeof r.status_note === "string" ? r.status_note : null,
        generated_by: ["gemini", "fallback_template"].includes(r.generated_by) ? r.generated_by : null,
        is_open_now: typeof r.is_open_now === "boolean" ? r.is_open_now : null,
        budget_warning: typeof r.budget_warning === "string" ? r.budget_warning : null,
        // Исходные теги OSM: неизвестные значения не превращаем в обещание доступности.
        wheelchair: typeof r.wheelchair === "string" ? r.wheelchair : null,
        accessibility: typeof r.accessibility === "string" ? r.accessibility : null,
        phone: typeof r.phone === "string" ? r.phone : null,
        website: typeof r.website === "string" ? r.website : null,
        wikidata: typeof r.wikidata === "string" ? r.wikidata : null,
      }));
  }

  function sanitizeQueryContext(value) {
    if (!isObject(value)) return null;
    return {
      latitude: isFiniteNumber(value.latitude) && Math.abs(value.latitude) <= 90 ? value.latitude : null,
      longitude: isFiniteNumber(value.longitude) && Math.abs(value.longitude) <= 180 ? value.longitude : null,
      categories: Array.isArray(value.categories) ? value.categories.filter((c) => typeof c === "string") : [],
      duration_minutes: Number.isInteger(value.duration_minutes) && value.duration_minutes >= 15 && value.duration_minutes <= 240
        ? value.duration_minutes : null,
      transport: value.transport === "walking" ? value.transport : null,
    };
  }

  function recommendationResult(body, recommendations, degraded = false) {
    return {
      recommendations,
      has_more: body.has_more === true,
      degraded: degraded || recommendations.some((r) => r.generated_by === "fallback_template"),
      language: ["ru", "kk"].includes(body.language) ? body.language : null,
      query_context: sanitizeQueryContext(body.query_context),
    };
  }

  function errorFields(body) {
    if (isObject(body) && isObject(body.error)) {
      const { code, message } = body.error;
      return {
        code: typeof code === "string" ? code : null,
        serverMessage: typeof message === "string" && message.length <= 200 ? message : null,
      };
    }
    return { code: null, serverMessage: null };
  }

  /**
   * POST /api/recommendations.
   * @returns {Promise<{recommendations: Array, has_more: boolean, degraded: boolean, language: string|null, query_context: object|null}>}
   */
  async function getRecommendations(payload) {
    const response = await send("/api/recommendations", {
      method: "POST",
      body: payload,
      timeoutMs: CFG.REQUEST_TIMEOUT_MS,
    });
    const body = await readJson(response);

    if (response.ok) {
      const recs = isObject(body) ? sanitizeRecommendations(body.recommendations) : null;
      if (recs === null) throw new ApiError("unknown", { status: response.status });
      return recommendationResult(body, recs);
    }

    const { code, serverMessage } = errorFields(body);
    const status = response.status;

    if (status === 400 || status === 422) {
      throw new ApiError("validation", { status, code, serverMessage });
    }
    if (status === 429) {
      throw new ApiError("rate_limited", { status, code });
    }
    if (status === 503) {
      // Места всё равно могут прийти — с шаблонными объяснениями.
      const recs = isObject(body) ? sanitizeRecommendations(body.recommendations) : null;
      if (recs && recs.length) return recommendationResult(body, recs, true);
      throw new ApiError("ai_unavailable", { status, code });
    }
    if (status === 500) {
      throw new ApiError("internal", { status, code });
    }
    throw new ApiError("unknown", { status, code });
  }

  /** GET /api/health → "ok" | "down" | "mock" */
  async function checkHealth() {
    try {
      const response = await send("/api/health", { timeoutMs: CFG.HEALTH_TIMEOUT_MS });
      const body = await readJson(response);
      if (response.ok && isObject(body) && body.status === "ok") {
        return CFG.USE_MOCK ? "mock" : "ok";
      }
      return "down";
    } catch {
      return "down";
    }
  }

  window.Api = Object.freeze({ ApiError, getRecommendations, checkHealth });
})();
