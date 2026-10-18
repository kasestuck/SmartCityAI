/*
 * Виджеты главной: погода (Open-Meteo) и новости Астаны (GDELT).
 * Оба сервиса бесплатные, без ключей; запросы идут для фиксированной точки
 * «Астана» — никаких данных пользователя в них нет.
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const R = window.Render;
  const t = window.I18N.t;
  const { el } = R;

  // Последние данные — чтобы при смене языка перерисовать без новых запросов.
  const last = { weatherBox: null, weather: undefined, newsBox: null, news: null };

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------ Погода ------------------------------ */

  const WMO = [
    [[0], "lc-sun.svg", "w_clear"],
    [[1], "lc-cloud-sun.svg", "w_mostly_clear"],
    [[2], "lc-cloud-sun.svg", "w_partly"],
    [[3], "lc-cloud.svg", "w_overcast"],
    [[45, 48], "lc-cloud-fog.svg", "w_fog"],
    [[51, 53, 55], "lc-cloud-drizzle.svg", "w_drizzle"],
    [[56, 57], "lc-cloud-rain.svg", "w_freezing_drizzle"],
    [[61, 63, 65], "lc-cloud-rain.svg", "w_rain"],
    [[66, 67], "lc-cloud-rain.svg", "w_freezing_rain"],
    [[71, 73, 75, 77], "lc-cloud-snow.svg", "w_snow"],
    [[80, 81, 82], "lc-cloud-rain.svg", "w_showers"],
    [[85, 86], "lc-cloud-snow.svg", "w_snow_showers"],
    [[95, 96, 99], "lc-cloud-lightning.svg", "w_storm"],
  ];

  function describe(code) {
    const found = WMO.find(([codes]) => codes.includes(code));
    return found ? { icon: found[1], text: t(found[2]) } : { icon: "lc-thermometer.svg", text: t("w_unknown") };
  }

  const signed = (x) => `${x > 0 ? "+" : ""}${Math.round(x)}°`;

  function walkTip({ temp, code, wind }) {
    if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99, 51, 53, 55, 56, 57].includes(code)) return t("tip_wet");
    if ([71, 73, 75, 77, 85, 86].includes(code)) return t("tip_snow");
    if (temp <= -15) return t("tip_frost");
    if (wind >= 10) return t("tip_wind");
    if (temp >= 28) return t("tip_heat");
    if (temp < 5) return t("tip_cool");
    return t("tip_good");
  }

  function renderWeather() {
    const box = last.weatherBox;
    if (!box || last.weather === undefined) return;
    const body = box.querySelector("[data-weather-body]");
    const data = last.weather;
    if (!data) {
      body.replaceChildren(el("p", { class: "t-small", text: t("weather_error") }));
      return;
    }
    const c = data.current;
    const d = describe(c.weather_code);
    const max = data.daily?.temperature_2m_max?.[0];
    const min = data.daily?.temperature_2m_min?.[0];
    const stats = [
      Number.isFinite(c.apparent_temperature) ? t("w_feels", { t: signed(c.apparent_temperature) }) : null,
      Number.isFinite(c.wind_speed_10m) ? t("w_wind", { v: Math.round(c.wind_speed_10m) }) : null,
      Number.isFinite(c.relative_humidity_2m) ? t("w_humidity", { v: Math.round(c.relative_humidity_2m) }) : null,
      Number.isFinite(min) && Number.isFinite(max) ? t("w_today", { min: signed(min), max: signed(max) }) : null,
    ].filter(Boolean);
    body.replaceChildren(
      el(
        "div",
        { class: "weather__now" },
        R.icon(d.icon, 44, "weather__icon"),
        el("div", {}, el("p", { class: "weather__temp", text: signed(c.temperature_2m) }), el("p", { class: "weather__desc", text: d.text }))
      ),
      el("ul", { class: "weather__stats" }, stats.map((x) => el("li", { text: x }))),
      el("p", { class: "weather__tip", text: walkTip({ temp: c.temperature_2m, code: c.weather_code, wind: c.wind_speed_10m }) })
    );
  }

  async function loadWeather(box) {
    const { lat, lon } = CFG.WEATHER_POINT;
    const url =
      "https://api.open-meteo.com/v1/forecast?" +
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
        daily: "temperature_2m_max,temperature_2m_min",
        forecast_days: "1",
        wind_speed_unit: "ms",
        timezone: "auto",
      });
    last.weatherBox = box;
    try {
      const data = await fetchJson(url, CFG.WIDGET_TIMEOUT_MS);
      if (!data || !data.current || !Number.isFinite(data.current.temperature_2m)) throw new Error("bad");
      last.weather = data;
    } catch {
      last.weather = null;
    } finally {
      renderWeather();
      box.setAttribute("aria-busy", "false");
    }
  }

  /* ------------------------------ Новости ----------------------------- */

  // Кешируем только заголовки новостей (никаких данных пользователя),
  // чтобы перезагрузки страницы не упирались в лимит GDELT (1 запрос / 5 с).
  const NEWS_CACHE_KEY = "astana-news-v2";
  const NEWS_STALE_MS = 24 * 60 * 60 * 1000;

  function readCache() {
    try {
      const { t, items } = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || "null") || {};
      if (!Array.isArray(items) || !items.length || Date.now() - t > NEWS_STALE_MS) return null;
      return { t, items, fresh: Date.now() - t < CFG.NEWS_CACHE_MS };
    } catch {
      return null;
    }
  }

  function writeCache(items) {
    try {
      localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ t: Date.now(), items }));
    } catch {
      /* хранилище недоступно — не страшно */
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // GDELT ставит пробелы вокруг знаков препинания: «Астана - 1 » → «Астана-1»
  function cleanTitle(s) {
    return String(s)
      .replace(/\s+([,.:;!?»)])/g, "$1")
      .replace(/([«(])\s+/g, "$1")
      .replace(/\s+-\s+(\d)/g, "-$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function parseSeen(s) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  function timeAgo(ts) {
    if (!ts) return null;
    const min = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (min < 60) return t("ago_min", { n: min });
    const h = Math.round(min / 60);
    if (h < 24) return t("ago_h", { n: h });
    return t("ago_d", { n: Math.round(h / 24) });
  }

  function safeUrl(u) {
    try {
      const url = new URL(u);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  async function fetchNews() {
    const url =
      "https://api.gdeltproject.org/api/v2/doc/doc?" +
      new URLSearchParams({
        query: "(Астана OR Astana OR Астанада) sourcecountry:KZ",
        mode: "artlist",
        maxrecords: "30",
        format: "json",
        sort: "datedesc",
        timespan: "3d",
      });
    // GDELT часто отвечает 429 (без CORS-заголовка → «Failed to fetch») или очень долго:
    // пробуем несколько раз с паузой больше 5 с.
    let data = null;
    for (let attempt = 1; ; attempt++) {
      try {
        data = await fetchJson(url, CFG.NEWS_TIMEOUT_MS);
        break;
      } catch (err) {
        if (attempt >= CFG.NEWS_ATTEMPTS) throw err;
        await sleep(6000);
      }
    }
    const list = (data && Array.isArray(data.articles) ? data.articles : [])
      .map((a) => ({
        title: cleanTitle(a.title || ""),
        url: safeUrl(a.url),
        domain: typeof a.domain === "string" ? a.domain : "",
        lang: a.language,
        ts: parseSeen(a.seendate),
      }))
      .filter((a) => a.title && a.url);
    // Сначала русскоязычные, затем остальные; без повторов заголовков.
    const seen = new Set();
    const ordered = [...list.filter((a) => a.lang === "Russian"), ...list.filter((a) => a.lang !== "Russian")].filter(
      (a) => (seen.has(a.title) ? false : seen.add(a.title))
    );
    return ordered.slice(0, CFG.NEWS_COUNT);
  }

  function renderNews(list, items) {
    list.replaceChildren(
      ...items.map((n) =>
        el(
          "li",
          { class: "news__item" },
          el(
            "a",
            { class: "news__link", attrs: { href: n.url, target: "_blank", rel: "noopener noreferrer" } },
            n.title,
            el("span", { class: "visually-hidden", text: t("new_tab") })
          ),
          el("p", { class: "news__meta", text: [n.domain, timeAgo(n.ts)].filter(Boolean).join(" · ") })
        )
      )
    );
  }

  const NEWS_FALLBACK = [
    { key: "news_fb_1", url: "https://www.inform.kz/ru", domain: "inform.kz" },
    { key: "news_fb_2", url: "https://tengrinews.kz/", domain: "tengrinews.kz" },
    { key: "news_fb_3", url: "https://astanatv.kz/ru/", domain: "astanatv.kz" },
  ];

  // status: null | {key, ago?}
  function renderNewsState() {
    const box = last.newsBox;
    const st = last.news;
    if (!box || !st) return;
    const list = box.querySelector("[data-news-list]");
    if (st.items) renderNews(list, st.items);
    else if (st.fallback) renderNews(list, NEWS_FALLBACK.map((f) => ({ ...f, title: t(f.key) })));
    const status = st.status ? t(st.status.key, st.status.ago ? { ago: timeAgo(st.status.ago) } : undefined) : "";
    box.querySelector("[data-news-status]").textContent = status;
  }

  async function loadNews(box) {
    last.newsBox = box;
    const cached = readCache();
    // Есть сохранённые заголовки — показываем сразу, свежие подгружаем в фоне.
    if (cached) {
      last.news = { items: cached.items, status: cached.fresh ? null : { key: "news_updating" } };
      renderNewsState();
      box.setAttribute("aria-busy", "false");
      if (cached.fresh) return;
    }
    try {
      const items = await fetchNews();
      if (!items.length) throw new Error("empty");
      writeCache(items);
      last.news = { items, status: null };
    } catch {
      last.news = cached
        ? { items: cached.items, status: { key: "news_stale", ago: cached.t } }
        : { fallback: true, status: { key: "news_down" } };
    } finally {
      renderNewsState();
      box.setAttribute("aria-busy", "false");
    }
  }

  function rerender() {
    renderWeather();
    renderNewsState();
  }

  window.Widgets = Object.freeze({ loadWeather, loadNews, rerender });
})();
