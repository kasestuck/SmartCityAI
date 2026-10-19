/*
 * Логика формы, вывод результатов, экраны «Карта» и «Место».
 * Координаты, текст запроса и особые потребности живут только в памяти вкладки:
 * не пишутся в localStorage/sessionStorage/cookies и не логируются.
 * Все тексты интерфейса — через window.I18N (js/i18n.js).
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const R = window.Render;
  const I = window.I18N;
  const t = I.t;
  const { el } = R;
  const $ = (id) => document.getElementById(id);

  const state = {
    location: null, // { kind, lat, lon, acc?, landmark? } — подписи считаются из kind
    geoMessage: null, // { title, text } — ключи словаря
    searchOrigin: null,
    results: [],
    degraded: false,
    responseLanguage: null,
    queryContext: null,
    lastPayload: null,
    lastQuery: "",
    lastNeeds: [],
    selectedId: null,
    inFlight: false,
    searchVersion: 0,
    hasMore: false,
    moreInFlight: false,
    moreError: null,
    rateLimitUntil: 0,
    rateTimer: null,
    pendingPick: null,
    screen: { type: "intro" }, // intro | loading | results | error
    health: "checking",
    mapMode: null, // city | around; null — выбрать автоматически
  };

  const maps = { home: null, results: null, big: null, detail: null, pick: null };
  let resultsMapId = null;

  const dom = {};

  /* ------------------------------------------------------------------ */
  /* Форма                                                               */
  /* ------------------------------------------------------------------ */

  function chipOption({ type, name, value, id, label, checked }) {
    const input = el("input", {
      class: "chip-option__input",
      attrs: { type, name, value, id, checked: checked || null },
    });
    return el("label", { class: "chip-option", attrs: { for: id } }, input, el("span", { class: "chip", text: label }));
  }

  function buildDurationOptions() {
    const box = $("duration-options");
    const current = getDuration();
    box.replaceChildren(
      ...CFG.DURATIONS.map((min) =>
        chipOption({
          type: "radio",
          name: "duration",
          value: String(min),
          id: `duration-${min}`,
          label: R.formatDurationChoice(min),
          checked: min === (Number.isFinite(current) ? current : CFG.DEFAULT_DURATION),
        })
      )
    );
  }

  function buildCategoryOptions() {
    const box = $("category-options");
    const selected = box.childElementCount ? getCategories() : [];
    box.replaceChildren(
      chipOption({ type: "checkbox", name: "category-all", value: "all", id: "category-all", label: t("category_all"), checked: true }),
      ...CFG.CATEGORIES.map((c) =>
        chipOption({ type: "checkbox", name: "category", value: c.value, id: `category-${c.value}`, label: R.categoryInfo(c.value).chip })
      )
    );
    setCategories(selected);
  }

  function onCategoryChange(e) {
    const box = $("category-options");
    const all = $("category-all");
    const others = [...box.querySelectorAll('input[name="category"]')];
    if (e.target === all) {
      if (all.checked) others.forEach((o) => (o.checked = false));
      else if (!others.some((o) => o.checked)) all.checked = true;
    } else {
      all.checked = !others.some((o) => o.checked);
    }
  }

  function getCategories() {
    return [...document.querySelectorAll('#category-options input[name="category"]:checked')].map((i) => i.value);
  }

  function setCategories(values) {
    const set = new Set(values || []);
    document.querySelectorAll('#category-options input[name="category"]').forEach((i) => (i.checked = set.has(i.value)));
    $("category-all").checked = set.size === 0;
  }

  function getDuration() {
    const checked = document.querySelector('#duration-options input[name="duration"]:checked');
    return checked ? Number(checked.value) : NaN;
  }

  function setDuration(min) {
    const input = $(`duration-${min}`);
    if (input) input.checked = true;
  }

  // Особые потребности: необязательный критерий подбора.
  function buildNeedOptions() {
    const hintKey = CFG.FEATURES.ACCESSIBILITY_FIELD ? "a11y_hint" : "a11y_hint_unsupported";
    $("a11y-hint").setAttribute("data-i18n", hintKey);
    $("a11y-hint").textContent = t(hintKey);
    const box = $("a11y-options");
    const selected = getNeeds();
    box.replaceChildren(
      ...CFG.ACCESSIBILITY_NEEDS.map((need) =>
        chipOption({ type: "checkbox", name: "a11y", value: need, id: `a11y-${need}`, label: t(`a11y_${need}`), checked: selected.includes(need) })
      )
    );
  }

  function getNeeds() {
    return [...document.querySelectorAll('#a11y-options input[name="a11y"]:checked')].map((i) => i.value);
  }

  function needsText(needs) {
    return needs.map((n) => t(`a11y_need_${n}`)).join(", ");
  }

  function buildScenarios() {
    const box = $("scenario-list");
    box.replaceChildren(
      ...CFG.SCENARIOS.map((s) => {
        const cats = s.categories.map((c) => R.categoryInfo(c).chip.toLowerCase()).join(", ");
        return el(
          "button",
          {
            class: "chip",
            attrs: { type: "button", "data-scenario": s.id },
            on: { click: () => runScenario(s) },
          },
          R.icon(s.icon, 16),
          t(`sc_${s.id}`),
          el("span", {
            class: "visually-hidden",
            text: t("scenario_sr", { q: t(`sc_${s.id}_q`), d: R.formatDurationChoice(s.duration), cats }),
          })
        );
      })
    );
    if (state.inFlight || isRateLimited()) box.querySelectorAll("button").forEach((b) => (b.disabled = true));
  }

  function runScenario(s) {
    dom.query.value = t(`sc_${s.id}_q`);
    updateCounter();
    setDuration(s.duration);
    setCategories(s.categories);
    goTo("#/guide");
    submitForm();
  }

  // Главная → AI-гид: переносим текст запроса в форму гида и ищем.
  function submitHomeForm() {
    const home = $("home-query");
    const err = $("home-query-error");
    const query = home.value.trim();
    if (!query) {
      err.textContent = t("err_query_empty");
      err.hidden = false;
      home.setAttribute("aria-invalid", "true");
      home.focus();
      return;
    }
    err.hidden = true;
    home.removeAttribute("aria-invalid");
    dom.query.value = query;
    updateCounter();
    goTo("#/guide");
    submitForm();
  }

  function updateCounter() {
    const len = dom.query.value.trim().length;
    dom.counter.textContent = `${len} / ${CFG.QUERY_MAX_LENGTH}`;
  }

  /* ------------------------------------------------------------------ */
  /* Местоположение                                                      */
  /* ------------------------------------------------------------------ */

  const fmt = (n) => n.toFixed(4);
  const coords = (loc) => `${fmt(loc.lat)}, ${fmt(loc.lon)}`;

  function locationText(loc) {
    switch (loc.kind) {
      case "geo": {
        const acc = R.formatDistance(loc.acc);
        return { title: t("geo_title"), sub: acc ? t("geo_sub_acc", { acc }) : t("geo_sub") };
      }
      case "center":
        return { title: t("center_btn"), sub: t("center_sub", { coords: coords(loc) }) };
      case "manual":
        return { title: t("manual_title"), sub: `${loc.lat}, ${loc.lon}` };
      case "landmark":
        return { title: t("landmark_title", { name: t(`lm_${loc.landmark}`) }), sub: t("landmark_sub", { coords: coords(loc) }) };
      default:
        return { title: t("pick_loc_title"), sub: t("pick_loc_sub", { coords: coords(loc) }) };
    }
  }

  function renderLocation() {
    const text = state.location ? locationText(state.location) : { title: t("loc_none_title"), sub: t("loc_none_sub") };
    $("location-title").textContent = text.title;
    $("location-sub").textContent = text.sub;
  }

  function setLocation(loc) {
    state.location = loc;
    renderLocation();
    clearFieldError("location");
    if (loc.kind !== "center") hideGeoDenied();
  }

  function showGeoDenied(titleKey, textKey) {
    state.geoMessage = { title: titleKey, text: textKey };
    renderGeoDenied();
    $("geo-denied").setAttribute("role", "alert");
  }

  function renderGeoDenied() {
    const box = $("geo-denied");
    if (!state.geoMessage) {
      box.hidden = true;
      return;
    }
    $("geo-denied-title").textContent = t(state.geoMessage.title);
    $("geo-denied-text").textContent = t(state.geoMessage.text);
    box.hidden = false;
  }

  function hideGeoDenied() {
    state.geoMessage = null;
    $("geo-denied").removeAttribute("role");
    renderGeoDenied();
  }

  function useGeolocation() {
    const btn = $("geo-btn");
    if (!("geolocation" in navigator)) {
      showGeoDenied("geo_unsupported_title", "geo_alt_text");
      return;
    }
    btn.disabled = true;
    btn.classList.add("is-loading");
    $("location-sub").textContent = t("geo_locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        const { latitude, longitude, accuracy } = pos.coords;
        setLocation({ kind: "geo", lat: latitude, lon: longitude, acc: accuracy });
      },
      (err) => {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        renderLocation();
        if (err.code === err.PERMISSION_DENIED) showGeoDenied("geo_denied_title", "geo_denied_text");
        else if (err.code === err.TIMEOUT) showGeoDenied("geo_timeout_title", "geo_timeout_text");
        else showGeoDenied("geo_unavailable_title", "geo_alt_text");
        $("pick-btn").focus();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  function useCenter() {
    const { lat, lon } = CFG.ASTANA_CENTER;
    setLocation({ kind: "center", lat, lon });
  }

  function toggleManual() {
    const btn = $("manual-btn");
    const box = $("manual-coords");
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-pressed", String(open));
    if (open) $("manual-lat").focus();
  }

  function parseCoord(raw) {
    const s = String(raw).trim().replace(",", ".").replace("−", "-");
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }

  function applyManual() {
    const latEl = $("manual-lat");
    const lonEl = $("manual-lon");
    const errEl = $("manual-error");
    const lat = parseCoord(latEl.value);
    const lon = parseCoord(lonEl.value);
    const latOk = Number.isFinite(lat) && lat >= -90 && lat <= 90;
    const lonOk = Number.isFinite(lon) && lon >= -180 && lon <= 180;
    latEl.setAttribute("aria-invalid", String(!latOk));
    lonEl.setAttribute("aria-invalid", String(!lonOk));
    if (!latOk || !lonOk) {
      errEl.textContent = !latOk ? t("err_lat") : t("err_lon");
      errEl.hidden = false;
      (latOk ? lonEl : latEl).focus();
      return;
    }
    errEl.hidden = true;
    setLocation({ kind: "manual", lat, lon });
  }

  /* Диалог выбора точки */
  function renderPickStatus() {
    const p = state.pendingPick;
    $("pick-status").textContent = !p
      ? ""
      : p.landmark
        ? t("pick_status_landmark", { name: t(`lm_${p.landmark}`) })
        : t("pick_status_point", { coords: coords(p) });
  }

  function setPending(point, landmark) {
    state.pendingPick = { ...point, landmark };
    $("pick-confirm").disabled = false;
    renderPickStatus();
  }

  async function openPickDialog() {
    const dialog = $("pick-dialog");
    state.pendingPick = null;
    $("pick-confirm").disabled = true;
    renderPickStatus();
    if (typeof dialog.showModal !== "function") {
      toggleManual();
      return;
    }
    dialog.showModal();
    const point = state.location ? { lat: state.location.lat, lon: state.location.lon } : null;
    const center = CFG.MAP_DEFAULT_CENTER;
    const onPick = (lat, lon) => setPending({ lat, lon }, null);
    if (maps.pick) {
      maps.pick.show({ center, point, onPick });
      return;
    }
    const box = $("pick-map");
    box.setAttribute("aria-busy", "true");
    try {
      maps.pick = await window.PickMap.create(box, { center, point, onPick });
    } catch {
      box.replaceChildren(el("p", { class: "t-small pickmap__error", text: t("pick_map_error") }));
    } finally {
      box.removeAttribute("aria-busy");
    }
  }

  function closePickDialog() {
    $("pick-dialog").close();
    $("pick-btn").focus();
  }

  function buildLandmarkButtons() {
    $("pick-landmarks").replaceChildren(
      ...CFG.LANDMARKS.map((lm) =>
        el("button", {
          class: "chip",
          text: t(`lm_${lm.key}`),
          attrs: { type: "button" },
          on: {
            click: () => {
              const point = { lat: lm.lat, lon: lm.lon };
              if (maps.pick) {
                maps.pick.show({ center: point, point });
                maps.pick.mark(point);
              }
              setPending(point, lm.key);
            },
          },
        })
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Валидация и отправка                                                */
  /* ------------------------------------------------------------------ */

  function clearFieldError(field) {
    if (field === "query") {
      $("query-error").hidden = true;
      dom.query.removeAttribute("aria-invalid");
    }
    if (field === "location") {
      $("location-error").hidden = true;
      $("location-field").classList.remove("is-invalid");
    }
  }

  function setFieldError(field, message) {
    if (field === "query") {
      const e = $("query-error");
      e.textContent = message;
      e.hidden = false;
      dom.query.setAttribute("aria-invalid", "true");
    }
    if (field === "location") {
      const e = $("location-error");
      e.textContent = message;
      e.hidden = false;
      $("location-field").classList.add("is-invalid");
    }
  }

  function focusField(field) {
    if (field === "query") dom.query.focus();
    else if (field === "location") $("geo-btn").focus();
    else if (field === "duration") document.querySelector("#duration-options input")?.focus();
  }

  function validate() {
    const errors = [];
    const query = dom.query.value.trim();
    if (!query) errors.push({ field: "query", message: t("err_query_empty") });
    else if (query.length > CFG.QUERY_MAX_LENGTH)
      errors.push({ field: "query", message: t("err_query_long", { max: CFG.QUERY_MAX_LENGTH }) });

    const loc = state.location;
    if (!loc) {
      errors.push({ field: "location", message: t("err_location") });
    } else if (
      !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon) ||
      loc.lat < -90 || loc.lat > 90 || loc.lon < -180 || loc.lon > 180
    ) {
      errors.push({ field: "location", message: t("err_location_range") });
    }

    const duration = getDuration();
    if (!Number.isInteger(duration) || duration < 15 || duration > 240 || !CFG.DURATIONS.includes(duration)) {
      errors.push({ field: "duration", message: t("err_duration") });
    }
    return { errors, query, duration };
  }

  function buildPayload(query, duration) {
    const payload = {
      latitude: Number(state.location.lat),
      longitude: Number(state.location.lon),
      query,
      duration_minutes: duration,
      transport: CFG.TRANSPORT,
    };
    const categories = getCategories();
    if (categories.length) payload.categories = categories;
    // Доступность отправляем только в mock: реальный API поддерживает её лишь в ответе.
    const needs = getNeeds();
    if (needs.length && CFG.FEATURES.ACCESSIBILITY_FIELD) payload.accessibility = needs;
    if (CFG.FEATURES.LANGUAGE_FIELD) payload.language = I.lang === "kk" ? "kk" : "ru";
    return payload;
  }

  function hideFormAlert() {
    $("form-alert").hidden = true;
  }

  function submitForm() {
    hideFormAlert();
    clearFieldError("query");
    clearFieldError("location");
    const { errors, query, duration } = validate();
    if (errors.length) {
      errors.forEach((e) => setFieldError(e.field, e.message));
      focusField(errors[0].field);
      return;
    }
    state.lastNeeds = getNeeds();
    runSearch(buildPayload(query, duration));
  }

  function isRateLimited() {
    return Date.now() < state.rateLimitUntil;
  }

  function submitLabel() {
    if (isRateLimited()) return t("wait_s", { s: Math.ceil((state.rateLimitUntil - Date.now()) / 1000) });
    return state.inFlight ? t("finding") : t("find");
  }

  function setBusy(busy) {
    const btn = dom.submit;
    btn.classList.toggle("is-loading", busy);
    btn.disabled = busy || isRateLimited();
    btn.setAttribute("aria-disabled", String(btn.disabled));
    $("submit-label").textContent = submitLabel();
    document.querySelectorAll("#scenario-list button").forEach((b) => (b.disabled = busy || isRateLimited()));
    dom.results.setAttribute("aria-busy", String(busy));
    renderLoadMore();
  }

  async function runSearch(payload) {
    if (state.inFlight || isRateLimited()) return;
    const version = ++state.searchVersion;
    state.inFlight = true;
    state.hasMore = false;
    state.moreInFlight = false;
    state.moreError = null;
    // Later form or language edits must not alter this search's continuation.
    state.lastPayload = Object.freeze(Object.fromEntries(Object.entries(payload).map(([key, value]) =>
      [key, Array.isArray(value) ? Object.freeze([...value]) : value]
    )));
    setBusy(true);
    state.screen = { type: "loading" };
    renderScreen();
    try {
      const { recommendations, degraded, language, query_context, has_more } = await window.Api.getRecommendations(state.lastPayload);
      if (version !== state.searchVersion) return;
      state.results = unseenRecommendations(recommendations);
      state.hasMore = has_more && state.results.length > 0;
      state.degraded = degraded;
      state.responseLanguage = language || (CFG.USE_MOCK ? "ru" : payload.language || "ru");
      state.queryContext = query_context;
      state.lastQuery = payload.query;
      state.searchOrigin = { lat: payload.latitude, lon: payload.longitude };
      state.selectedId = recommendations.length ? recommendations[0].id : null;
      state.screen = { type: "results" };
    } catch (err) {
      if (version !== state.searchVersion) return;
      state.results = [];
      state.selectedId = null;
      state.screen = { type: "error", err: err instanceof window.Api.ApiError ? err : new window.Api.ApiError("unknown") };
    } finally {
      if (version === state.searchVersion) {
        state.inFlight = false;
        setBusy(false);
      }
    }
    renderScreen({ announceIt: true });
  }

  function unseenRecommendations(recommendations, previous = []) {
    const seen = new Set(previous.map((place) => place.id));
    return recommendations.filter((place) => {
      if (seen.has(place.id)) return false;
      seen.add(place.id);
      return true;
    }).slice(0, CFG.MAX_RESULTS);
  }

  async function loadMore() {
    if (!state.lastPayload || !state.hasMore || state.moreInFlight || state.inFlight || isRateLimited()) return;
    const version = state.searchVersion;
    const previousCount = state.results.length;
    state.moreInFlight = true;
    state.moreError = null;
    renderLoadMore();
    dom.results.setAttribute("aria-busy", "true");
    announce(t("loading_more"));
    try {
      const payload = { ...state.lastPayload, exclude_ids: state.results.map((place) => place.id) };
      const result = await window.Api.getRecommendations(payload);
      if (version !== state.searchVersion) return;
      const added = unseenRecommendations(result.recommendations, state.results);
      state.results.push(...added);
      state.hasMore = result.has_more && added.length > 0;
      state.degraded = state.degraded || result.degraded;
      renderResults(false, previousCount);
      announce(added.length ? t("more_added", { n: added.length }) : t("more_exhausted"));
    } catch (err) {
      if (version !== state.searchVersion) return;
      state.moreError = err instanceof window.Api.ApiError ? err : new window.Api.ApiError("unknown");
      if (state.moreError.kind === "rate_limited") startRateLimit();
      announce(t("more_error"));
    } finally {
      if (version === state.searchVersion) {
        state.moreInFlight = false;
        dom.results.setAttribute("aria-busy", "false");
        renderLoadMore();
      }
    }
  }

  function renderLoadMore() {
    const active = state.screen.type === "results" && state.results.length > 0;
    const button = $("load-more");
    $("load-more-controls").hidden = !active;
    button.hidden = !active || !state.hasMore;
    button.disabled = state.moreInFlight || state.inFlight || isRateLimited() || !state.hasMore;
    button.setAttribute("aria-disabled", String(button.disabled));
    button.classList.toggle("is-loading", state.moreInFlight);
    button.textContent = isRateLimited()
      ? t("wait_s", { s: Math.ceil((state.rateLimitUntil - Date.now()) / 1000) })
      : t(state.moreInFlight ? "loading_more" : state.moreError ? "retry_more" : "load_more");
    const status = $("load-more-status");
    status.textContent = !active ? "" : state.moreError
      ? t(isRateLimited() ? "err_rate_text" : "more_error")
      : !state.hasMore ? t("more_exhausted") : "";
    status.hidden = !status.textContent;
  }

  function startRateLimit() {
    state.rateLimitUntil = Date.now() + CFG.RATE_LIMIT_COOLDOWN_S * 1000;
    setBusy(false); // заблокирует кнопку и идеи на время паузы
    clearInterval(state.rateTimer);
    const tick = () => {
      if (!isRateLimited()) {
        clearInterval(state.rateTimer);
        state.rateLimitUntil = 0;
        setBusy(false);
        announce(t("can_search_again"));
        return;
      }
      $("submit-label").textContent = submitLabel();
      renderLoadMore();
    };
    tick();
    state.rateTimer = setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Вывод результатов и состояний                                       */
  /* ------------------------------------------------------------------ */

  function announce(text) {
    const live = $("results-live");
    live.textContent = "";
    // Новое сообщение в следующем кадре, чтобы скринридер его прочитал.
    requestAnimationFrame(() => (live.textContent = text));
  }

  function editQueryButton() {
    return el("button", {
      class: "btn btn--secondary btn--block",
      text: t("edit_query"),
      attrs: { type: "button" },
      on: {
        click: () => {
          dom.query.focus();
          dom.query.scrollIntoView({ block: "center" });
        },
      },
    });
  }

  function retryButton() {
    return el(
      "button",
      {
        class: "btn btn--primary btn--block",
        attrs: { type: "button", "data-retry": "" },
        on: {
          click: () => {
            if (state.lastPayload) runSearch(state.lastPayload);
          },
        },
      },
      R.icon("rotate-cw-white.svg", 18),
      t("retry")
    );
  }

  function resetResultsChrome(title) {
    $("results-title").textContent = title;
    $("results-sub").textContent = "";
    $("place-list").replaceChildren();
    $("results-note").hidden = true;
    $("results-aside").hidden = true;
    renderLoadMore();
  }

  function scrollToResults() {
    // На широком экране выдача и так рядом с формой.
    if (parseRoute().view !== "guide" || window.matchMedia("(min-width: 1024px)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dom.results.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  function introState() {
    return R.stateCard({ iconName: "sparkles-20.svg", title: t("intro_title"), text: t("intro_text") });
  }

  // Перерисовка выдачи по текущему состоянию (после поиска и при смене языка).
  function renderScreen({ announceIt = false } = {}) {
    const s = state.screen;
    if (s.type === "intro") {
      resetResultsChrome(t("recommend"));
      $("results-state").replaceChildren(introState());
    } else if (s.type === "loading") renderLoading();
    else if (s.type === "results") renderResults(announceIt);
    else if (s.type === "error") renderError(s.err, announceIt);
  }

  function renderLoading() {
    resetResultsChrome(t("recommend"));
    $("results-state").replaceChildren(
      R.stateCard({
        kind: "loading",
        iconName: "loader-circle.svg",
        title: t("loading_title"),
        text: t("loading_text"),
        extra: R.dots(),
        actions: [editQueryButton()],
      }),
      R.skeleton(),
      R.skeleton()
    );
    announce(t("finding"));
    scrollToResults();
  }

  function notice(text, info = true) {
    return el("p", { class: info ? "notice notice--info" : "notice" }, R.icon("sparkles-16.svg", 18), text);
  }

  function resultsLanguageNotice() {
    if (!state.responseLanguage || state.responseLanguage === I.lang) return null;
    if (CFG.USE_MOCK) return t("lang_mock_notice");
    if (I.lang === "en" && state.responseLanguage === "ru") return t("lang_api_fallback");
    return t("lang_results_notice", { language: t("lang_name_" + state.responseLanguage) });
  }

  function renderResults(announceIt, appendFrom = null) {
    const list = state.results;
    const n = list.length;
    $("results-state").replaceChildren();

    if (n === 0) {
      resetResultsChrome(t("nothing_found"));
      const actions = [editQueryButton()];
      if (getCategories().length) {
        actions.push(
          el("button", {
            class: "btn btn--secondary btn--block",
            text: t("search_all_cats"),
            attrs: { type: "button" },
            on: {
              click: () => {
                setCategories([]);
                submitForm();
              },
            },
          })
        );
      }
      $("results-state").append(
        R.stateCard({ iconName: "search-x.svg", title: t("empty_title"), text: t("empty_text"), actions })
      );
      if (announceIt) {
        announce(t("empty_announce"));
        $("results-title").focus({ preventScroll: true });
      }
      return;
    }

    const places = I.places(n);
    $("results-title").textContent = t("found_title", { n, places });
    $("results-sub").textContent = t("found_sub", { q: state.lastQuery });

    const notes = $("results-state");
    if (CFG.USE_MOCK) notes.append(notice(t("mock_notice")));
    if (state.lastNeeds.length) {
      const supported = CFG.FEATURES.ACCESSIBILITY_FIELD;
      notes.append(notice(t(supported ? "a11y_notice" : "a11y_notice_unsupported", { needs: needsText(state.lastNeeds) }), supported));
    }
    const languageNotice = resultsLanguageNotice();
    if (languageNotice) notes.append(notice(languageNotice));
    if (state.degraded) notes.append(notice(t("degraded_notice"), false));

    const askedWheelchair = state.lastNeeds.includes("wheelchair");
    const cards = list.slice(appendFrom ?? 0).map((p, i) => R.placeCard(p, { index: (appendFrom ?? 0) + i + 1, askedWheelchair }));
    if (appendFrom === null) $("place-list").replaceChildren(...cards);
    else $("place-list").append(...cards);
    $("results-note").hidden = false;
    renderLoadMore();

    const withCoords = list.filter(R.hasCoords);
    $("results-aside").hidden = withCoords.length === 0;
    if (withCoords.length) renderResultsMap();

    const current = parseRoute();
    if (current.view === "map") renderMapView(current.id);
    else if (current.view === "place") renderPlaceView(current.id);
    if (announceIt) {
      announce(t("found_announce", { n, places }));
      if (current.view === "guide") $("results-title").focus({ preventScroll: true });
    }
  }

  function errorView(err) {
    const s = Math.round(CFG.REQUEST_TIMEOUT_MS / 1000);
    switch (err.kind) {
      case "rate_limited":
        return { iconName: "clock-3.svg", title: t("err_rate_title"), text: t("err_rate_text"), retry: false };
      case "internal":
        return { iconName: "wifi-off.svg", title: t("err_internal_title"), text: t("err_internal_text"), retry: true };
      case "ai_unavailable":
        return { iconName: "wifi-off.svg", title: t("err_ai_title"), text: t("err_ai_text"), retry: true };
      case "network":
        return { iconName: "wifi-off.svg", title: t("err_network_title"), text: t("err_network_text"), retry: true };
      case "timeout":
        return { iconName: "wifi-off.svg", title: t("err_network_title"), text: t("err_timeout_text", { s }), retry: true };
      default:
        return { iconName: "wifi-off.svg", title: t("err_unknown_title"), text: t("err_unknown_text"), retry: true };
    }
  }

  function renderError(err, announceIt) {
    if (err.kind === "validation") {
      resetResultsChrome(t("recommend"));
      $("results-state").replaceChildren(introState());
      const alert = $("form-alert");
      alert.textContent = err.serverMessage ? `${err.serverMessage}. ${t("err_validation_suffix")}` : t("err_validation_suffix");
      alert.hidden = false;
      if (announceIt) {
        dom.query.setAttribute("aria-invalid", "true");
        dom.query.focus();
      }
      return;
    }

    resetResultsChrome(t("recommend"));
    const view = errorView(err);
    const actions = [];
    if (view.retry) actions.push(retryButton());
    actions.push(editQueryButton());
    $("results-state").replaceChildren(
      R.stateCard({ kind: "error", iconName: view.iconName, title: view.title, text: view.text, actions })
    );
    if (announceIt) {
      if (err.kind === "rate_limited") startRateLimit();
      announce(view.title);
      $("results-title").focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Карты                                                               */
  /* ------------------------------------------------------------------ */

  function placeTitle(p) {
    return t("gmap_place", { name: R.placeName(p) });
  }

  function renderResultsMap() {
    const places = state.results.filter(R.hasCoords);
    if (!places.length) return;
    if (!places.some((p) => p.id === resultsMapId)) resultsMapId = places[0].id;
    const current = places.find((p) => p.id === resultsMapId);
    if (!maps.results) maps.results = window.GMap.create($("results-map"), { size: "compact" });
    maps.results.show({ lat: current.latitude, lon: current.longitude, zoom: 16 }, placeTitle(current));

    $("results-map-switch").replaceChildren(
      ...places.map((p) =>
        el(
          "button",
          {
            class: "chip",
            attrs: { type: "button", "aria-pressed": String(p.id === resultsMapId) },
            on: {
              click: () => {
                resultsMapId = p.id;
                renderResultsMap();
              },
            },
          },
          `${state.results.indexOf(p) + 1}. ${R.placeName(p)}`
        )
      )
    );
  }

  // Экран «Карта»: все места подборки на одной карте (Leaflet + OSM).
  const bigMap = { api: null, loading: null, failed: false, key: null, poiKey: null };

  function ensureBigMap() {
    if (bigMap.api || bigMap.failed) return Promise.resolve(bigMap.api);
    if (!bigMap.loading) {
      bigMap.loading = window.PlacesMap.create($("big-map"), {
        t,
        onSelect: (id) => selectOnMap(id, { fromMap: true }),
      })
        .then((api) => (bigMap.api = api))
        .catch(() => {
          bigMap.failed = true;
          $("big-map").replaceChildren(el("p", { class: "t-small pickmap__error", text: t("pick_map_error") }));
          return null;
        });
    }
    return bigMap.loading;
  }

  function selectOnMap(id, { fromMap = false } = {}) {
    state.selectedId = id;
    history.replaceState(null, "", `#/map/${encodeURIComponent(id)}`);
    renderMapSide(id);
    if (bigMap.api) bigMap.api.select(id, { pan: !fromMap });
  }

  function mapData(places, selectedId) {
    return {
      places: places.map((p) => ({
        id: p.id,
        name: R.placeName(p),
        lat: p.latitude,
        lon: p.longitude,
        iconName: R.categoryInfo(p.category).icon,
        category: R.categoryInfo(p.category).label,
        meta: R.metaLine(p),
      })),
      start: state.searchOrigin,
      selectedId,
      landmarks: CFG.LANDMARKS.map((lm) => ({ name: t(`lm_${lm.key}`), lat: lm.lat, lon: lm.lon })),
    };
  }

  function mapPlaces() {
    return state.results.filter(R.hasCoords);
  }

  // Правая колонка: выбранное место крупно, остальные — списком.
  function renderMapSide(id) {
    const side = $("map-side-list");
    const places = mapPlaces();
    if (!places.length) {
      side.replaceChildren(
        R.stateCard({
          iconName: "search-x.svg",
          title: t("map_empty_title"),
          text: t("map_empty_text"),
          actions: [el("a", { class: "btn btn--primary btn--block", attrs: { href: "#/guide" } }, t("find"))],
        })
      );
      return null;
    }
    const selected = places.find((p) => p.id === id) || places.find((p) => p.id === state.selectedId) || places[0];
    state.selectedId = selected.id;
    const index = state.results.indexOf(selected) + 1;
    const askedWheelchair = state.lastNeeds.includes("wheelchair");
    const languageNotice = resultsLanguageNotice();
    side.replaceChildren(
      ...(languageNotice ? [notice(languageNotice)] : []),
      R.placeCard(selected, { index, selected: true, compactActions: true, askedWheelchair }),
      ...places
        .filter((p) => p !== selected)
        .map((p) => R.placeMini(p, { index: state.results.indexOf(p) + 1, onSelect: (pid) => selectOnMap(pid) }))
    );
    return selected;
  }

  async function renderMapView(id) {
    const selected = renderMapSide(id);
    const api = await ensureBigMap();
    if (!api) return;
    const places = mapPlaces();
    // Перерисовываем метки, только если изменилась сама подборка, точка или язык.
    const key = JSON.stringify([places.map((p) => p.id), state.searchOrigin, I.lang]);
    if (key !== bigMap.key) {
      bigMap.key = key;
      bigMap.poiKey = null; // метки пересозданы — слой и вид тоже
      api.show(mapData(places, selected ? selected.id : null));
    } else {
      api.resize();
      if (selected) api.select(selected.id, { pan: false });
    }
    await updatePoiLayer();
  }

  /* Слой «все места»: вкладки «Вся карта» / «Вокруг» */

  function mapCenter() {
    return state.searchOrigin || (state.location ? { lat: state.location.lat, lon: state.location.lon } : null);
  }

  function currentMapMode() {
    const center = mapCenter();
    const mode = state.mapMode || (center ? "around" : "city");
    return mode === "around" && !center ? "city" : mode;
  }

  // Точки вокруг круга радиуса — чтобы карта вписала его целиком.
  function circleBounds(c, r) {
    const dLat = r / 111320;
    const dLon = r / (111320 * Math.cos((c.lat * Math.PI) / 180));
    return [
      [c.lat - dLat, c.lon - dLon],
      [c.lat + dLat, c.lon + dLon],
    ];
  }

  function poiPopup(p, center) {
    const box = el("div", { class: "pm-popup" },
      el("p", { class: "pm-popup__cat", text: R.categoryInfo(p.category).label }),
      el("p", { class: "pm-popup__name", text: R.placeName(p) })
    );
    if (center) {
      const d = R.formatDistance(window.Poi.haversine(center.lat, center.lon, p.lat, p.lon));
      box.append(el("p", { class: "pm-popup__meta", text: t("meta_dist", { d }) }));
    }
    box.append(
      el("a", {
        class: "pm-popup__link",
        text: t("route"),
        attrs: { href: window.GMap.routeUrl(p.lat, p.lon), target: "_blank", rel: "noopener noreferrer" },
      })
    );
    return box;
  }

  function renderMapLegend() {
    const colors = window.PlacesMap.CATEGORY_COLORS;
    const item = (swatch, text) => el("li", {}, swatch, text);
    $("map-legend").replaceChildren(
      item(el("span", { class: "map-legend__pick", text: "1" }), t("legend_pick")),
      ...CFG.CATEGORIES.map((c) =>
        item(el("span", { class: "map-legend__dot", attrs: { style: `background:${colors[c.value]}` } }), R.categoryInfo(c.value).chip)
      ),
      item(el("span", { class: "map-legend__dot map-legend__dot--landmark" }), t("legend_landmark"))
    );
  }

  async function updatePoiLayer({ force = false } = {}) {
    const api = bigMap.api;
    if (!api) return;
    const center = mapCenter();
    const mode = currentMapMode();
    document.querySelectorAll("[data-map-mode]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.mapMode === mode));
      if (b.dataset.mapMode === "around") {
        b.disabled = !center;
        b.title = center ? "" : t("map_around_need_point");
      }
    });
    renderMapLegend();

    const key = JSON.stringify([mode, center, I.lang, bigMap.key]);
    if (!force && key === bigMap.poiKey) return;
    bigMap.poiKey = key;

    let data;
    try {
      data = await window.Poi.loadAll();
    } catch {
      $("map-count").textContent = t("map_poi_error");
      return;
    }
    const radius = CFG.AROUND_RADIUS_M;
    let points;
    let fitTo;
    if (mode === "around") {
      points = window.Poi.around(data.places, center, radius);
      fitTo = circleBounds(center, radius); // «вокруг» — вид строго по кругу
      $("map-count").textContent = t("map_count_around", { n: points.length, places: I.places(points.length), r: R.formatDistance(radius) });
    } else {
      points = data.places;
      fitTo = points.map((p) => [p.lat, p.lon]);
      const src = data.source === "api"
        ? t("map_src_api")
        : t("map_src_snapshot", { date: data.collectedAt ? new Date(data.collectedAt).toLocaleDateString(I.lang === "en" ? "en-GB" : "ru-RU") : "—" });
      $("map-count").textContent =
        t("map_count_city", { n: points.length, places: I.places(points.length), src }) +
        (center ? "" : ` ${t("map_around_need_point")}`);
    }
    api.setPoi({
      points,
      circle: mode === "around" ? { lat: center.lat, lon: center.lon, radius } : null,
      fitTo,
      describe: (p) => poiPopup(p, center),
    });
    if (!center && mode === "around") $("map-count").textContent = t("map_around_need_point");
  }

  /* ------------------------------------------------------------------ */
  /* Детальная страница места                                            */
  /* ------------------------------------------------------------------ */

  function renderPlaceView(id) {
    const view = $("view-place");
    maps.detail = null;
    const place = state.results.find((p) => p.id === id);

    if (!place) {
      view.replaceChildren(
        el(
          "div",
          { class: "page-head" },
          el("a", { class: "back-link", attrs: { href: "#/" } }, R.icon("arrow-left.svg", 18), t("to_home")),
          el("h1", { class: "t-h1", text: t("place_not_found"), attrs: { tabindex: "-1", "data-focus": "" } })
        ),
        R.stateCard({
          iconName: "search-x.svg",
          title: t("place_not_in_pick_title"),
          text: t("place_not_in_pick_text"),
          actions: [el("a", { class: "btn btn--primary btn--block", attrs: { href: "#/guide" } }, t("to_search"))],
        })
      );
      return;
    }

    const cat = R.categoryInfo(place.category);
    const distance = R.formatDistance(place.distance_meters);
    const minutes = R.formatMinutes(place.estimated_duration_minutes);

    const hero = R.placeVisual(place, { badge: false });
    hero.classList.add("place-hero");
    hero.removeAttribute("aria-hidden");
    hero.append(
      el(
        "a",
        { class: "btn btn--secondary btn--pill place-hero__back", attrs: { href: "#/guide" } },
        R.icon("arrow-left.svg", 18),
        t("back_to_pick")
      ),
      el("span", { class: "badge-soft place-hero__badge" }, R.icon("sparkles-12.svg", 12), t("place_badge"))
    );

    const tags = el("div", { class: "chips" });
    if (distance) tags.append(el("span", { class: "tag" }, R.icon("marker-pin.svg", 14), t("meta_dist", { d: distance })));
    if (minutes) tags.append(el("span", { class: "tag" }, R.icon("clock-3.svg", 14), t("meta_time", { t: minutes })));

    const info = el("dl", { class: "info-card" });
    const addInfo = (term, value) => {
      if (!R.isPresent(value)) return;
      info.append(el("div", {}, el("dt", { text: term }), el("dd", { text: value })));
    };
    addInfo(t("info_category"), cat.label);
    if (R.hasCoords(place)) addInfo(t("info_coords"), `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`);
    if (R.isPresent(place.opening_hours)) addInfo(t("info_hours"), t("info_hours_value", { h: place.opening_hours }));
    addInfo(t("info_status"), R.openingStatusText(place));
    addInfo(t("transit_label"), R.transitStopText(place));
    addInfo(t("info_budget"), place.budget_warning);
    addInfo(t("info_generation"), R.generationText(place));
    addInfo(t("info_access"), R.accessibilityText(place, state.lastNeeds.includes("wheelchair")));
    if (R.isPresent(place.source)) addInfo(t("info_source"), t("info_source_value", { s: place.source }));

    const main = el(
      "div",
      { class: "place-main" },
      resultsLanguageNotice() ? notice(resultsLanguageNotice()) : null,
      el(
        "div",
        { class: "place-main__head" },
        el("p", { class: "place-main__category", text: cat.label }),
        el("h1", { class: "place-main__name", text: R.placeName(place), attrs: { tabindex: "-1", "data-focus": "" } }),
        tags.childElementCount ? tags : null,
        R.isPresent(place.description) ? el("p", { class: "t-body", text: place.description }) : null
      ),
      R.isPresent(place.reason)
        ? el(
            "section",
            { class: "why-box", attrs: { "aria-labelledby": "why-title" } },
            el("h2", { class: "t-h3 icon-title", attrs: { id: "why-title" } }, R.icon("sparkles-20.svg", 20), t("why_title")),
            el("p", { text: place.reason })
          )
        : null,
      R.isPresent(place.suggested_action)
        ? el(
            "section",
            { class: "place-main__head", attrs: { "aria-labelledby": "todo-title" } },
            el("h2", { class: "t-h3 icon-title", attrs: { id: "todo-title" } }, R.icon("compass-step.svg", 20), t("todo_title")),
            el("p", { class: "t-body", text: place.suggested_action })
          )
        : null,
      info.childElementCount
        ? el(
            "section",
            { class: "place-main__head", attrs: { "aria-labelledby": "info-title" } },
            el("h2", { class: "t-h3 icon-title", attrs: { id: "info-title" } }, R.icon("map-pin-header.svg", 20), t("info_title")),
            info
          )
        : null,
      el("p", { class: "t-caption", text: t("place_caption") })
    );

    const aside = el(
      "aside",
      { class: "place-aside", attrs: { "aria-labelledby": "aside-title" } },
      el("h2", { class: "t-h3", text: t("how_to_get"), attrs: { id: "aside-title" } }),
      el("p", { class: "t-small", text: t("straight_note") })
    );
    let mapBox = null;
    if (R.hasCoords(place)) {
      mapBox = el("div");
      aside.append(
        mapBox,
        R.externalLink("btn btn--primary btn--block", R.routeUrl(place), t("build_route"), t("route_sr", { name: R.placeName(place) }), "navigation-white.svg"),
        R.externalLink("btn btn--secondary btn--block", R.placeUrl(place), t("open_gmaps"), t("open_gmaps_sr", { name: R.placeName(place) }), null)
      );
    }
    aside.append(
      el("a", { class: "btn btn--secondary btn--block", attrs: { href: "#/guide" } }, t("back_to_recs")),
      el("p", { class: "t-caption", text: t("route_note") })
    );

    view.replaceChildren(hero, el("div", { class: "place-layout" }, main, aside));

    if (mapBox) {
      maps.detail = window.GMap.create(mapBox, { size: "detail" });
      maps.detail.show({ lat: place.latitude, lon: place.longitude, zoom: 16 }, placeTitle(place));
    }
    document.title = t("title_place", { name: R.placeName(place) });
  }

  /* ------------------------------------------------------------------ */
  /* Роутер (hash) — состояние остаётся в памяти, без хранилищ           */
  /* ------------------------------------------------------------------ */

  function parseRoute() {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const safe = (str) => {
      try {
        return decodeURIComponent(str);
      } catch {
        return str;
      }
    };
    if (parts[0] === "guide") return { view: "guide", nav: "guide" };
    if (parts[0] === "map") return { view: "map", nav: "map", id: parts[1] ? safe(parts[1]) : null };
    if (parts[0] === "place" && parts[1]) return { view: "place", nav: "guide", id: safe(parts[1]) };
    return { view: "home", nav: "home" };
  }

  // Переход без потери фокуса (например, сразу к полю с ошибкой).
  function goTo(hash) {
    if (window.location.hash !== hash) history.pushState(null, "", hash);
    route({ focus: false });
  }

  const TITLES = { home: "title_home", guide: "title_guide", map: "title_map" };

  function route({ focus = true, keepScroll = false } = {}) {
    const r = parseRoute();
    const changed = document.querySelector(`[data-view="${r.view}"]`).hidden;
    document.querySelectorAll("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== r.view));
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === r.nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (TITLES[r.view]) document.title = t(TITLES[r.view]);
    if (changed && !keepScroll) window.scrollTo(0, 0);

    let target = null;
    if (r.view === "home") target = $("hero-title");
    if (r.view === "guide") target = $("guide-title");
    if (r.view === "map") {
      renderMapView(r.id);
      target = $("map-title");
    }
    if (r.view === "place") {
      renderPlaceView(r.id);
      target = document.querySelector("#view-place [data-focus]");
    }
    if (focus && target) target.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* Health                                                              */
  /* ------------------------------------------------------------------ */

  function renderHealth() {
    const box = $("health");
    box.dataset.state = state.health;
    const text = t({ ok: "health_ok", mock: "health_mock", down: "health_down" }[state.health] || "health_checking");
    $("health-text").textContent = text;
    box.title = text;
    $("health-warning").hidden = state.health !== "down";
  }

  async function checkHealth() {
    state.health = await window.Api.checkHealth();
    renderHealth();
  }

  /* ------------------------------------------------------------------ */
  /* Смена языка: перерисовываем всё, ничего не теряя                    */
  /* ------------------------------------------------------------------ */

  function onLanguageChange() {
    buildDurationOptions();
    buildCategoryOptions();
    buildNeedOptions();
    buildScenarios();
    buildLandmarkButtons();
    renderLocation();
    renderGeoDenied();
    renderPickStatus();
    renderHealth();
    clearFieldError("query");
    clearFieldError("location");
    $("manual-error").hidden = true;
    $("home-query-error").hidden = true;
    if (!state.inFlight) $("submit-label").textContent = submitLabel();
    if (state.screen.type !== "loading") renderScreen();
    if (maps.home) maps.home.show({ query: "Астана", zoom: 12 }, t("gmap_astana"));
    route({ focus: false, keepScroll: true });
    window.Widgets.rerender();
  }

  /* ------------------------------------------------------------------ */
  /* Инициализация                                                       */
  /* ------------------------------------------------------------------ */

  function init() {
    dom.form = $("search-form");
    dom.query = $("query");
    dom.counter = $("query-counter");
    dom.submit = $("submit-btn");
    dom.results = $("results");

    I.apply();
    buildDurationOptions();
    buildCategoryOptions();
    buildNeedOptions();
    buildScenarios();
    buildLandmarkButtons();
    renderLocation();
    updateCounter();
    $("submit-label").textContent = submitLabel();

    $("category-options").addEventListener("change", onCategoryChange);
    $("load-more").addEventListener("click", loadMore);
    document.querySelectorAll("[data-map-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        state.mapMode = b.dataset.mapMode;
        updatePoiLayer({ force: true });
      })
    );
    document.querySelectorAll("[data-lang]").forEach((btn) => btn.addEventListener("click", () => I.set(btn.dataset.lang)));
    I.onChange(onLanguageChange);

    dom.form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitForm();
    });
    dom.query.addEventListener("input", () => {
      updateCounter();
      if (dom.query.value.trim()) clearFieldError("query");
      hideFormAlert();
    });
    // Enter — отправить, Shift+Enter — перенос строки.
    dom.query.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitForm();
      }
    });

    $("geo-btn").addEventListener("click", useGeolocation);
    $("center-btn").addEventListener("click", useCenter);
    $("manual-btn").addEventListener("click", toggleManual);
    $("manual-apply").addEventListener("click", applyManual);
    ["manual-lat", "manual-lon"].forEach((id) =>
      $(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyManual();
        }
      })
    );
    $("pick-btn").addEventListener("click", openPickDialog);
    $("pick-close").addEventListener("click", closePickDialog);
    $("pick-cancel").addEventListener("click", closePickDialog);
    $("pick-confirm").addEventListener("click", () => {
      const p = state.pendingPick;
      if (!p) return;
      setLocation(p.landmark ? { kind: "landmark", lat: p.lat, lon: p.lon, landmark: p.landmark } : { kind: "pick", lat: p.lat, lon: p.lon });
      closePickDialog();
    });

    // Ссылка «к содержанию» не должна менять hash-маршрут.
    document.querySelector(".skip-link").addEventListener("click", (e) => {
      e.preventDefault();
      $("main").focus();
    });
    // Повторный клик по текущему пункту меню тоже срабатывает.
    document.querySelectorAll("[data-nav]").forEach((a) =>
      a.addEventListener("click", () => {
        if (a.getAttribute("href") === window.location.hash) route();
      })
    );

    $("home-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submitHomeForm();
    });
    $("home-query").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitHomeForm();
      }
    });
    $("home-query").addEventListener("input", () => {
      $("home-query-error").hidden = true;
      $("home-query").removeAttribute("aria-invalid");
    });

    maps.home = window.GMap.create($("home-map"), { size: "home", title: t("gmap_astana") });
    maps.home.show({ query: "Астана", zoom: 12 }, t("gmap_astana"));
    renderScreen();
    $("news-more").href = CFG.NEWS_MORE_URL;
    window.Widgets.loadWeather($("weather"));
    window.Widgets.loadNews($("news"));

    window.addEventListener("hashchange", () => route());
    window.addEventListener("popstate", () => route());
    route({ focus: false });
    renderHealth();
    checkHealth();

    // Демо для презентации: ?demo=<id идеи> запускает сценарий
    // от явно подписанной точки «Центр Астаны».
    const demo = CFG.SCENARIOS.find((s) => s.id === new URLSearchParams(window.location.search).get("demo"));
    if (demo) {
      const requested = window.location.hash;
      useCenter();
      runScenario(demo);
      // ?demo=…#/map — остаёмся на запрошенном экране, выдача дорисуется туда.
      if (/^#\/(map|place)/.test(requested)) {
        history.replaceState(null, "", requested);
        route({ focus: false });
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
