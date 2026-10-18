/*
 * Логика формы, вывод результатов, экраны «Карта» и «Место».
 * Координаты и текст запроса живут только в памяти вкладки:
 * не пишутся в localStorage/sessionStorage/cookies и не логируются.
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const R = window.Render;
  const { el } = R;
  const $ = (id) => document.getElementById(id);

  const state = {
    location: null, // { lat, lon, kind, title, sub }
    searchOrigin: null, // точка, из которой искали (для маркера «я»)
    results: [],
    degraded: false,
    lastPayload: null,
    lastQuery: "",
    selectedId: null,
    inFlight: false,
    rateLimitUntil: 0,
    rateTimer: null,
    pendingPick: null,
  };

  const maps = { home: null, results: null, big: null, detail: null, pick: null };

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
    for (const min of CFG.DURATIONS) {
      box.append(
        chipOption({
          type: "radio",
          name: "duration",
          value: String(min),
          id: `duration-${min}`,
          label: R.formatDurationChoice(min),
          checked: min === CFG.DEFAULT_DURATION,
        })
      );
    }
  }

  function buildCategoryOptions() {
    const box = $("category-options");
    box.append(chipOption({ type: "checkbox", name: "category-all", value: "all", id: "category-all", label: "Все", checked: true }));
    for (const c of CFG.CATEGORIES) {
      box.append(chipOption({ type: "checkbox", name: "category", value: c.value, id: `category-${c.value}`, label: c.chip }));
    }
    box.addEventListener("change", (e) => {
      const all = $("category-all");
      const others = [...box.querySelectorAll('input[name="category"]')];
      if (e.target === all) {
        if (all.checked) others.forEach((o) => (o.checked = false));
        else if (!others.some((o) => o.checked)) all.checked = true;
      } else {
        all.checked = !others.some((o) => o.checked);
      }
    });
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

  function buildScenarios() {
    const box = $("scenario-list");
    for (const s of CFG.SCENARIOS) {
      const cats = s.categories.map((c) => R.categoryInfo(c).chip.toLowerCase()).join(", ");
      box.append(
        el(
          "button",
          {
            class: "chip",
            attrs: { type: "button", "data-scenario": s.id },
            on: { click: () => runScenario(s) },
          },
          s.label,
          el("span", {
            class: "visually-hidden",
            text: ` — запустить поиск: «${s.query}», ${R.formatDurationChoice(s.duration)}, ${cats}`,
          })
        )
      );
    }
  }

  function runScenario(s) {
    dom.query.value = s.query;
    updateCounter();
    setDuration(s.duration);
    setCategories(s.categories);
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

  function setLocation(loc) {
    state.location = loc;
    $("location-title").textContent = loc.title;
    $("location-sub").textContent = loc.sub;
    clearFieldError("location");
    if (loc.kind !== "center") hideGeoDenied();
  }

  function showGeoDenied(title, text) {
    const box = $("geo-denied");
    $("geo-denied-title").textContent = title;
    $("geo-denied-text").textContent = text;
    box.setAttribute("role", "alert");
    box.hidden = false;
  }

  function hideGeoDenied() {
    const box = $("geo-denied");
    box.hidden = true;
    box.removeAttribute("role");
  }

  function useGeolocation() {
    const btn = $("geo-btn");
    if (!("geolocation" in navigator)) {
      showGeoDenied(
        "Браузер не умеет определять местоположение.",
        "Выбери точку на карте, начни от центра Астаны или введи координаты."
      );
      return;
    }
    btn.disabled = true;
    btn.classList.add("is-loading");
    $("location-sub").textContent = "Определяем местоположение…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        const { latitude, longitude, accuracy } = pos.coords;
        const acc = R.formatDistance(accuracy);
        setLocation({
          lat: latitude,
          lon: longitude,
          kind: "geo",
          title: "Моё местоположение",
          sub: acc ? `Определено по геолокации · точность ≈ ${acc}` : "Определено по геолокации",
        });
      },
      (err) => {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        restoreLocationText();
        if (err.code === err.PERMISSION_DENIED) {
          showGeoDenied(
            "Укажи своё местоположение на карте.",
            "Доступ к геолокации не дан — это нормально. Выбери точку вручную, начни от центра Астаны или введи координаты."
          );
        } else if (err.code === err.TIMEOUT) {
          showGeoDenied(
            "Не удалось определить местоположение вовремя.",
            "Попробуй ещё раз или выбери точку на карте вручную."
          );
        } else {
          showGeoDenied(
            "Местоположение сейчас недоступно.",
            "Выбери точку на карте, начни от центра Астаны или введи координаты."
          );
        }
        $("pick-btn").focus();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  function restoreLocationText() {
    if (state.location) {
      $("location-sub").textContent = state.location.sub;
    } else {
      $("location-sub").textContent = "Выбери один из вариантов ниже";
    }
  }

  function useCenter() {
    const { lat, lon } = CFG.ASTANA_CENTER;
    setLocation({
      lat,
      lon,
      kind: "center",
      title: "Центр Астаны",
      sub: `Стандартная точка ${fmt(lat)}, ${fmt(lon)} — не твоё местоположение`,
    });
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
      errEl.textContent = !latOk
        ? "Широта — число от −90 до 90, например 51.1283."
        : "Долгота — число от −180 до 180, например 71.4305.";
      errEl.hidden = false;
      (latOk ? lonEl : latEl).focus();
      return;
    }
    errEl.hidden = true;
    setLocation({ lat, lon, kind: "manual", title: "Координаты вручную", sub: `${lat}, ${lon}` });
  }

  /* Диалог выбора точки на схеме */
  function openPickDialog() {
    const dialog = $("pick-dialog");
    state.pendingPick = null;
    $("pick-confirm").disabled = true;
    if (typeof dialog.showModal !== "function") {
      toggleManual();
      return;
    }
    dialog.showModal();
    const user = state.location ? { lat: state.location.lat, lon: state.location.lon } : null;
    if (!maps.pick) {
      maps.pick = window.SchematicMap.create($("pick-map"), {
        size: "pick",
        pick: true,
        user,
        ariaLabel: "Схема Астаны: нажми, чтобы выбрать точку отправления",
        onPick: (lat, lon) => {
          state.pendingPick = { lat, lon };
          maps.pick.update({ user: state.pendingPick, userPending: true });
          $("pick-confirm").disabled = false;
        },
      });
    } else {
      maps.pick.update({ user, userPending: false });
    }
  }

  function closePickDialog() {
    $("pick-dialog").close();
    $("pick-btn").focus();
  }

  function buildLandmarkButtons() {
    const box = $("pick-landmarks");
    window.SchematicMap.LANDMARKS.filter((l) => !["Есиль", "Правый берег"].includes(l.name)).forEach((lm) => {
      box.append(
        el("button", {
          class: "chip",
          text: lm.name,
          attrs: { type: "button" },
          on: {
            click: () => {
              setLocation({
                lat: lm.lat,
                lon: lm.lon,
                kind: "landmark",
                title: `Рядом с: ${lm.name}`,
                sub: "Ориентир на схеме, координаты приблизительные",
              });
              closePickDialog();
            },
          },
        })
      );
    });
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
    else if (field === "duration") document.querySelector('#duration-options input')?.focus();
  }

  function validate() {
    const errors = [];
    const query = dom.query.value.trim();
    if (!query) errors.push({ field: "query", message: "Напиши пару слов о том, чего хочется." });
    else if (query.length > CFG.QUERY_MAX_LENGTH)
      errors.push({ field: "query", message: `Слишком длинный запрос: максимум ${CFG.QUERY_MAX_LENGTH} символов.` });

    const loc = state.location;
    if (!loc) {
      errors.push({
        field: "location",
        message: "Укажи точку отправления: геолокация, точка на карте, центр Астаны или координаты.",
      });
    } else if (
      !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon) ||
      loc.lat < -90 || loc.lat > 90 || loc.lon < -180 || loc.lon > 180
    ) {
      errors.push({ field: "location", message: "Координаты вне допустимого диапазона. Выбери точку заново." });
    }

    const duration = getDuration();
    if (!Number.isInteger(duration) || duration < 15 || duration > 240 || !CFG.DURATIONS.includes(duration)) {
      errors.push({ field: "duration", message: "Выбери, сколько есть времени." });
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
    runSearch(buildPayload(query, duration));
  }

  function isRateLimited() {
    return Date.now() < state.rateLimitUntil;
  }

  function setBusy(busy) {
    const btn = dom.submit;
    btn.classList.toggle("is-loading", busy);
    btn.disabled = busy || isRateLimited();
    btn.setAttribute("aria-disabled", String(btn.disabled));
    if (!isRateLimited()) $("submit-label").textContent = busy ? "Подбираем места…" : "Найти места ✨";
    document.querySelectorAll("#scenario-list button").forEach((b) => (b.disabled = busy || isRateLimited()));
    dom.results.setAttribute("aria-busy", String(busy));
  }

  async function runSearch(payload) {
    if (state.inFlight || isRateLimited()) return;
    state.inFlight = true;
    state.lastPayload = payload;
    setBusy(true);
    renderLoading();
    try {
      const { recommendations, degraded } = await window.Api.getRecommendations(payload);
      state.results = recommendations;
      state.degraded = degraded;
      state.lastQuery = payload.query;
      state.searchOrigin = { lat: payload.latitude, lon: payload.longitude };
      state.selectedId = recommendations.length ? recommendations[0].id : null;
      renderResults();
    } catch (err) {
      state.results = [];
      state.selectedId = null;
      renderError(err instanceof window.Api.ApiError ? err : new window.Api.ApiError("unknown"));
    } finally {
      state.inFlight = false;
      setBusy(false);
    }
  }

  function startRateLimit() {
    state.rateLimitUntil = Date.now() + CFG.RATE_LIMIT_COOLDOWN_S * 1000;
    clearInterval(state.rateTimer);
    const tick = () => {
      const left = Math.ceil((state.rateLimitUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(state.rateTimer);
        state.rateLimitUntil = 0;
        $("submit-label").textContent = "Найти места ✨";
        setBusy(false);
        announce("Можно снова искать места.");
        document.querySelectorAll("[data-retry]").forEach((b) => (b.disabled = false));
        return;
      }
      $("submit-label").textContent = `Подождите ${left} с`;
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
      text: "Изменить запрос",
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
      "Повторить"
    );
  }

  function showResultsSection() {
    dom.results.hidden = false;
  }

  function resetResultsChrome(title) {
    $("results-title").textContent = title;
    $("results-sub").textContent = "";
    $("place-list").replaceChildren();
    $("results-note").hidden = true;
    $("results-aside").hidden = true;
  }

  function scrollToResults() {
    if (parseRoute().view !== "home") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dom.results.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  function renderLoading() {
    showResultsSection();
    resetResultsChrome("Рекомендуем");
    $("results-state").replaceChildren(
      R.stateCard({
        kind: "loading",
        iconName: "loader-circle.svg",
        title: "Подбираем интересные места для тебя...",
        text: "Собираем идеи под твой запрос и время на прогулку.",
        extra: R.dots(),
        actions: [editQueryButton()],
      }),
      R.skeleton(),
      R.skeleton()
    );
    announce("Подбираем места…");
    scrollToResults();
  }

  function renderResults() {
    showResultsSection();
    const list = state.results.slice(0, CFG.MAX_RESULTS);
    const n = list.length;
    $("results-state").replaceChildren();

    if (n === 0) {
      resetResultsChrome("Ничего не нашлось");
      const actions = [editQueryButton()];
      if (getCategories().length) {
        actions.push(
          el("button", {
            class: "btn btn--secondary btn--block",
            text: "Искать во всех категориях",
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
        R.stateCard({
          iconName: "search-x.svg",
          title: "Пока не нашли подходящих мест. Попробуй изменить запрос.",
          text: "Выбери другую категорию, добавь немного времени или начни из другой точки.",
          actions,
        })
      );
      announce("Подходящих мест не найдено. Попробуй изменить запрос.");
      $("results-title").focus({ preventScroll: true });
      return;
    }

    $("results-title").textContent = `Нашёл для тебя ${n} ${R.pluralPlaces(n)} ✨`;
    $("results-sub").textContent = `По запросу «${state.lastQuery}». Выбери одно место — это альтернативы, а не маршрут.`;

    if (state.degraded) {
      $("results-state").append(
        el(
          "p",
          { class: "notice" },
          R.icon("sparkles-16.svg", 18),
          "AI-объяснения сейчас недоступны — пояснения к местам составлены по шаблону."
        )
      );
    }

    const listEl = $("place-list");
    listEl.replaceChildren(...list.map((p, i) => R.placeCard(p, { index: i + 1 })));
    $("results-note").hidden = false;

    const withCoords = list.filter(R.hasCoords);
    $("results-aside").hidden = withCoords.length === 0;
    if (withCoords.length) renderResultsMap();

    announce(`Найдено ${n} ${R.pluralPlaces(n)}.`);
    const current = parseRoute();
    if (current.view === "map") renderMapView(current.id);
    else if (current.view === "place") renderPlaceView(current.id);
    else $("results-title").focus({ preventScroll: true });
  }

  function errorView(err) {
    const timeoutSec = Math.round(CFG.REQUEST_TIMEOUT_MS / 1000);
    switch (err.kind) {
      case "rate_limited":
        return {
          kind: "error",
          iconName: "clock-3.svg",
          title: "Слишком много запросов, подождите минуту",
          text: "Кнопка поиска снова станет активной через минуту. Введённый запрос сохранён.",
          retry: false,
        };
      case "internal":
        return {
          kind: "error",
          iconName: "wifi-off.svg",
          title: "Что-то пошло не так, попробуйте позже",
          text: "На сервере произошла ошибка. Запрос сохранён — можно повторить.",
          retry: true,
        };
      case "ai_unavailable":
        return {
          kind: "error",
          iconName: "wifi-off.svg",
          title: "Сервис временно недоступен",
          text: "Попробуй повторить запрос чуть позже.",
          retry: true,
        };
      case "network":
        return {
          kind: "error",
          iconName: "wifi-off.svg",
          title: "Нет связи с сервером",
          text: "Не удалось загрузить рекомендации. Проверь подключение к интернету и попробуй ещё раз.",
          retry: true,
        };
      case "timeout":
        return {
          kind: "error",
          iconName: "wifi-off.svg",
          title: "Нет связи с сервером",
          text: `Сервер не ответил за ${timeoutSec} секунд. Попробуй ещё раз.`,
          retry: true,
        };
      default:
        return {
          kind: "error",
          iconName: "wifi-off.svg",
          title: "Не удалось получить рекомендации",
          text: "Что-то пошло не так, попробуйте позже.",
          retry: true,
        };
    }
  }

  function renderError(err) {
    if (err.kind === "validation") {
      dom.results.hidden = true;
      $("results-state").replaceChildren();
      const alert = $("form-alert");
      alert.textContent = err.serverMessage
        ? `${err.serverMessage}. Проверь текст запроса и параметры поиска.`
        : "Проверь текст запроса и параметры поиска.";
      alert.hidden = false;
      dom.query.setAttribute("aria-invalid", "true");
      dom.query.focus();
      return;
    }

    showResultsSection();
    resetResultsChrome("Рекомендуем");
    const view = errorView(err);
    const actions = [];
    if (view.retry) actions.push(retryButton());
    actions.push(editQueryButton());
    $("results-state").replaceChildren(
      R.stateCard({ kind: view.kind, iconName: view.iconName, title: view.title, text: view.text, actions })
    );
    if (err.kind === "rate_limited") startRateLimit();
    announce(view.title);
    $("results-title").focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* Карты                                                               */
  /* ------------------------------------------------------------------ */

  function mapPlaces() {
    return state.results.filter(R.hasCoords).map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.latitude,
      lon: p.longitude,
      category: p.category,
      label: R.categoryInfo(p.category).label,
    }));
  }

  function renderResultsMap() {
    const opts = {
      size: "compact",
      places: mapPlaces(),
      user: state.searchOrigin,
      selectedId: null,
      onSelect: (id) => (window.location.hash = `#/map/${encodeURIComponent(id)}`),
      ariaLabel: "Схема с найденными местами. Нажми на маркер, чтобы открыть его на большой карте.",
    };
    if (maps.results) maps.results.update(opts);
    else maps.results = window.SchematicMap.create($("results-map"), opts);
  }

  const bigMapOverlay = {};

  function ensureBigMap() {
    if (maps.big) return;
    const container = $("big-map");
    bigMapOverlay.count = el("span", { class: "badge-soft map__count" });
    bigMapOverlay.popup = el("div", { class: "map__popup" });
    container.append(bigMapOverlay.count, bigMapOverlay.popup);
    maps.big = window.SchematicMap.create(container, {
      size: "large",
      padRatio: 0.2,
      reserveBottom: (w) => (w >= 400 && window.matchMedia("(min-width: 768px)").matches ? 240 : 0),
      ariaLabel: "Схематичная карта с найденными местами",
      onSelect: (id) => selectOnMap(id, true),
    });
  }

  function selectOnMap(id, fromMarker) {
    state.selectedId = id;
    history.replaceState(null, "", `#/map/${encodeURIComponent(id)}`);
    renderMapView(id);
    if (fromMarker) {
      const marker = $("big-map").querySelector(`.marker[data-id="${CSS.escape(id)}"]`);
      if (marker) marker.focus();
    }
  }

  function renderMapView(id) {
    ensureBigMap();
    const side = $("map-side-list");
    const places = state.results.slice(0, CFG.MAX_RESULTS);

    if (!places.length) {
      maps.big.update({ places: [], user: state.searchOrigin, selectedId: null });
      bigMapOverlay.count.hidden = true;
      bigMapOverlay.popup.hidden = true;
      side.replaceChildren(
        R.stateCard({
          iconName: "search-x.svg",
          title: "Пока здесь пусто",
          text: "Найди места на главной — до трёх рекомендаций появятся на карте.",
          actions: [
            el(
              "a",
              { class: "btn btn--primary btn--block", attrs: { href: "#/" } },
              "Найти места ✨"
            ),
          ],
        })
      );
      return;
    }

    const selected = places.find((p) => p.id === id) || places.find((p) => p.id === state.selectedId) || places[0];
    state.selectedId = selected.id;
    maps.big.update({ places: mapPlaces(), user: state.searchOrigin, selectedId: selected.id });

    const n = places.length;
    bigMapOverlay.count.hidden = false;
    bigMapOverlay.count.replaceChildren(R.icon("sparkles-12.svg", 12), `${n} ${R.pluralPlaces(n)} для тебя`);

    const popup = bigMapOverlay.popup;
    const meta = R.metaLine(selected);
    popup.hidden = false;
    popup.replaceChildren(
      el(
        "div",
        { class: "map__popup-head" },
        R.placeVisual(selected, { badge: false }),
        el(
          "div",
          {},
          el("p", { class: "t-h3", text: selected.name }),
          el("p", { class: "place-card__category", text: R.categoryInfo(selected.category).label }),
          meta ? el("p", { class: "place-card__meta", text: meta }) : null
        )
      ),
      R.isPresent(selected.reason) ? el("p", { class: "map__popup-reason", text: selected.reason }) : null,
      el(
        "a",
        { class: "btn btn--secondary btn--sm", attrs: { href: `#/place/${encodeURIComponent(selected.id)}` } },
        "Подробнее",
        el("span", { class: "visually-hidden", text: ` о месте «${selected.name}»` })
      )
    );

    const index = places.indexOf(selected) + 1;
    side.replaceChildren(
      R.placeCard(selected, { index, selected: true, compactActions: true }),
      ...places
        .filter((p) => p !== selected)
        .map((p) => R.placeMini(p, { index: places.indexOf(p) + 1, onSelect: (pid) => selectOnMap(pid, false) }))
    );
  }

  /* ------------------------------------------------------------------ */
  /* Детальная страница места                                            */
  /* ------------------------------------------------------------------ */

  function renderPlaceView(id) {
    const view = $("view-place");
    if (maps.detail) {
      maps.detail.destroy();
      maps.detail = null;
    }
    const place = state.results.find((p) => p.id === id);

    if (!place) {
      view.replaceChildren(
        el(
          "div",
          { class: "page-head" },
          el("a", { class: "back-link", attrs: { href: "#/" } }, R.icon("arrow-left.svg", 18), "На главную"),
          el("h1", { class: "t-h1", text: "Место не найдено", attrs: { tabindex: "-1", "data-focus": "" } })
        ),
        R.stateCard({
          iconName: "search-x.svg",
          title: "Этого места нет в текущей подборке",
          text: "Детали доступны только для мест из последнего поиска. Найди места заново — это займёт пару секунд.",
          actions: [el("a", { class: "btn btn--primary btn--block", attrs: { href: "#/" } }, "К поиску")],
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
    hero.querySelector(".place-visual__emoji").setAttribute("aria-hidden", "true");
    hero.append(
      el(
        "a",
        { class: "btn btn--secondary btn--pill place-hero__back", attrs: { href: "#/guide" } },
        R.icon("arrow-left.svg", 18),
        "Назад к подборке"
      ),
      el("span", { class: "badge-soft place-hero__badge" }, R.icon("sparkles-12.svg", 12), "Место для твоей прогулки")
    );

    const tags = el("div", { class: "chips" });
    if (distance) tags.append(el("span", { class: "tag" }, R.icon("marker-pin.svg", 14), `≈ ${distance} по прямой`));
    if (minutes) tags.append(el("span", { class: "tag" }, R.icon("clock-3.svg", 14), `${minutes} на дорогу и визит`));

    const info = el("dl", { class: "info-card" });
    const addInfo = (term, value) => {
      if (!R.isPresent(value)) return;
      info.append(el("div", {}, el("dt", { text: term }), el("dd", { text: value })));
    };
    addInfo("Категория", cat.label);
    if (R.hasCoords(place)) addInfo("Координаты", `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`);
    if (R.isPresent(place.opening_hours)) {
      addInfo("Часы работы (по данным OSM)", `${place.opening_hours}. Уточняйте перед визитом.`);
    }
    if (R.isPresent(place.source)) {
      addInfo("Источник", `${place.source}. Уточняйте входы, правила посещения и другие детали перед прогулкой.`);
    }

    const main = el(
      "div",
      { class: "place-main" },
      el(
        "div",
        { class: "place-main__head" },
        el("p", { class: "place-main__category", text: cat.label }),
        el("h1", { class: "place-main__name", text: place.name, attrs: { tabindex: "-1", "data-focus": "" } }),
        tags.childElementCount ? tags : null,
        R.isPresent(place.description) ? el("p", { class: "t-body", text: place.description }) : null
      ),
      R.isPresent(place.reason)
        ? el(
            "section",
            { class: "why-box", attrs: { "aria-labelledby": "why-title" } },
            el("h2", { class: "t-h3 icon-title", attrs: { id: "why-title" } }, R.icon("sparkles-20.svg", 20), "Почему тебе понравится"),
            el("p", { text: place.reason })
          )
        : null,
      R.isPresent(place.suggested_action)
        ? el(
            "section",
            { class: "place-main__head", attrs: { "aria-labelledby": "todo-title" } },
            el("h2", { class: "t-h3 icon-title", attrs: { id: "todo-title" } }, R.icon("compass-step.svg", 20), "Что здесь сделать"),
            el("p", { class: "t-body", text: place.suggested_action })
          )
        : null,
      info.childElementCount
        ? el(
            "section",
            { class: "place-main__head", attrs: { "aria-labelledby": "info-title" } },
            el("h2", { class: "t-h3 icon-title", attrs: { id: "info-title" } }, R.icon("map-pin-header.svg", 20), "Информация о месте"),
            info
          )
        : null,
      el("p", {
        class: "t-caption",
        text: "Расстояние по прямой и время приблизительные. Объяснение сформулировано ИИ или по шаблону; уточняйте детали перед посещением.",
      })
    );

    const aside = el("aside", { class: "place-aside", attrs: { "aria-labelledby": "aside-title" } },
      el("h2", { class: "t-h3", text: "Как добраться", attrs: { id: "aside-title" } }),
      el("p", { class: "t-small", text: "Расстояние указано по прямой — пешком путь может быть длиннее." })
    );
    let mapBox = null;
    if (R.hasCoords(place)) {
      mapBox = el("div");
      aside.append(
        mapBox,
        R.externalLink(
          "btn btn--primary btn--block",
          R.osmRouteUrl(place),
          "Построить маршрут",
          ` до «${place.name}» в OpenStreetMap (откроется в новой вкладке)`,
          "navigation-white.svg"
        ),
        R.externalLink(
          "btn btn--secondary btn--block",
          R.osmPlaceUrl(place),
          "Открыть в OpenStreetMap",
          ` место «${place.name}» (откроется в новой вкладке)`,
          null
        )
      );
    }
    aside.append(
      el("a", { class: "btn btn--secondary btn--block", attrs: { href: "#/guide" } }, "Вернуться к рекомендациям"),
      el("p", {
        class: "t-caption",
        text: "Маршрут строится на сайте OpenStreetMap: туда передаются только координаты места, а точку старта ты вводишь сам.",
      })
    );

    view.replaceChildren(hero, el("div", { class: "place-layout" }, main, aside));

    if (mapBox) {
      maps.detail = window.SchematicMap.create(mapBox, {
        size: "detail",
        places: [{ id: place.id, name: place.name, lat: place.latitude, lon: place.longitude, category: place.category, label: cat.label }],
        user: state.searchOrigin,
        selectedId: place.id,
        padRatio: 0.35,
        ariaLabel: `Схема: где находится «${place.name}» относительно точки отправления`,
      });
    }
    document.title = `${place.name} — ASTANA GO AI`;
  }

  /* ------------------------------------------------------------------ */
  /* Роутер (hash) — состояние остаётся в памяти, без хранилищ           */
  /* ------------------------------------------------------------------ */

  function parseRoute() {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const safe = (s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    if (parts[0] === "guide") return { view: "home", nav: "guide" };
    if (parts[0] === "map") return { view: "map", nav: "map", id: parts[1] ? safe(parts[1]) : null };
    if (parts[0] === "place" && parts[1]) return { view: "place", nav: "guide", id: safe(parts[1]) };
    return { view: "home", nav: "home" };
  }

  function route(initial = false) {
    const r = parseRoute();
    document.querySelectorAll("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== r.view));
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === r.nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    if (r.view === "home") {
      document.title = "ASTANA GO AI — куда сходить рядом в Астане";
      if (r.nav === "guide") {
        if (!dom.results.hidden) {
          scrollToResults();
          $("results-title").focus({ preventScroll: true });
        } else {
          dom.query.scrollIntoView({ block: "center" });
          dom.query.focus({ preventScroll: true });
        }
      } else if (!initial) {
        window.scrollTo(0, 0);
      }
      // Карта главной получает размеры только когда видима.
      if (maps.home) maps.home.update({});
      if (maps.results) maps.results.update({});
      return;
    }

    window.scrollTo(0, 0);
    if (r.view === "map") {
      document.title = "Карта — ASTANA GO AI";
      renderMapView(r.id);
      if (!initial) $("map-title").focus({ preventScroll: true });
    } else if (r.view === "place") {
      renderPlaceView(r.id);
      if (!initial) document.querySelector("#view-place [data-focus]")?.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Health                                                              */
  /* ------------------------------------------------------------------ */

  async function checkHealth() {
    const box = $("health");
    const status = await window.Api.checkHealth();
    box.dataset.state = status;
    const text = {
      ok: "Сервис работает",
      mock: "Демо-режим (mock)",
      down: "Сервис недоступен",
    }[status];
    $("health-text").textContent = text;
    box.title = text;
    $("health-warning").hidden = status !== "down";
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

    buildDurationOptions();
    buildCategoryOptions();
    buildScenarios();
    buildLandmarkButtons();
    updateCounter();

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
      if (!state.pendingPick) return;
      const { lat, lon } = state.pendingPick;
      setLocation({ lat, lon, kind: "pick", title: "Точка на карте", sub: `Выбрана на схеме · ${fmt(lat)}, ${fmt(lon)}` });
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

    maps.home = window.SchematicMap.create($("home-map"), {
      size: "home",
      ariaLabel: "Схематичная карта Астаны с ориентирами",
    });

    window.addEventListener("hashchange", () => route());
    route(true);
    checkHealth();

    // Демо для презентации: ?demo=walk|coffee|family|culture|views
    // запускает сценарий от явно подписанной точки «Центр Астаны».
    const demo = CFG.SCENARIOS.find((s) => s.id === new URLSearchParams(window.location.search).get("demo"));
    if (demo) {
      useCenter();
      runScenario(demo);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
