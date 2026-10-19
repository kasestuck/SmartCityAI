"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

// Small DOM boundary for the actual scripts; maps and remote widgets do no network IO.
class Element {
  constructor(tag = "div", text = "") {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.events = {};
    this.className = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this._text = text;
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(" "), ...names])].join(" ").trim(); },
      remove: (...names) => { this.className = this.className.split(" ").filter((n) => !names.includes(n)).join(" "); },
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.className.split(" ").includes(name) : force;
        this.classList[enabled ? "add" : "remove"](name);
      },
    };
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get childElementCount() { return this.children.filter((child) => child.tagName !== "#text").length; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    if (name === "value") this.value = String(value);
    if (name === "checked") this.checked = true;
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  dispatch(name, event = {}) { for (const fn of this.events[name] || []) fn({ preventDefault() {}, target: this, ...event }); }
  focus() {}
  scrollIntoView() {}
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    let scope = [this];
    for (const token of selector.split(/\s+/)) {
      const found = [];
      function visit(node) {
        for (const child of node.children) {
          if (matches(child, token)) found.push(child);
          visit(child);
        }
      }
      scope.forEach(visit);
      scope = [...new Set(found)];
    }
    return scope;
  }
}

function matches(node, selector) {
  const tag = selector.match(/^[a-z]+/i)?.[0];
  if (tag && node.tagName !== tag) return false;
  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && node.getAttribute("id") !== id) return false;
  const cls = selector.match(/\.([\w-]+)/)?.[1];
  if (cls && !node.className.split(" ").includes(cls)) return false;
  if (selector.includes(":checked") && !node.checked) return false;
  for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (node.getAttribute(name) === null || (value !== undefined && node.getAttribute(name) !== value)) return false;
  }
  return true;
}

function fixture(overrides = {}) {
  return {
    recommendations: [{
      id: "osm_node_123", name: "Test cafe", latitude: 51.09, longitude: 71.42,
      category: "cafe", description: null, reason: "A nearby cafe.",
      distance_meters: 250, estimated_duration_minutes: 45, suggested_action: "Check before visiting.",
      opening_hours: "Mo-Su 10:00-18:00", source: "OpenStreetMap",
      status_note: "По расписанию OpenStreetMap; фактические часы уточните.",
      generated_by: "fallback_template", is_open_now: false,
      budget_warning: "Превышает ваш бюджет на 15 минут", wheelchair: "limited",
      accessibility: "limited", phone: "+7 000 000", website: "https://example.com", wikidata: "Q123",
    }],
    query_context: { latitude: 51.09, longitude: 71.42, categories: ["cafe"], duration_minutes: 30, transport: "walking" },
    language: "ru",
    has_more: false,
    ...overrides,
  };
}

function browser({ lang = "ru", body = fixture(), status = 200, search = "", main = false, responses = null, clock = null } = {}) {
  const document = new Element("document");
  document.documentElement = new Element("html");
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (text) => new Element("#text", text);
  document.getElementById = (id) => document.querySelector("#" + id);
  // Only static hooks are needed. The real render/main code builds all dynamic UI.
  for (const match of read("index.html").matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attrs = [...match[2].matchAll(/([\w-]+)="([^"]*)"/g)];
    if (!attrs.some(([, name, value]) => name === "id" || name.startsWith("data-") || (name === "class" && value.includes("skip-link")))) continue;
    const node = new Element(match[1]);
    attrs.forEach(([, name, value]) => node.setAttribute(name, value));
    if (/\bhidden\b/.test(match[2])) node.hidden = true;
    document.append(node);
  }
  const requests = [];
  const events = {};
  const window = {
    document, location: { search: "?lang=" + lang + search, hash: "#/guide", href: "http://localhost:5173/" },
    addEventListener: (event, fn) => (events[event] ??= []).push(fn),
    matchMedia: () => ({ matches: true }), scrollTo() {},
    GMap: { create: () => ({ show() {} }), routeUrl: () => "https://maps.google.com", placeUrl: () => "https://maps.google.com" },
    Widgets: { loadWeather() {}, loadNews() {}, rerender() {} },
    Poi: { loadAll: async () => ({ source: "snapshot", places: [] }), around: () => [] },
    PlacesMap: {
      CATEGORY_COLORS: {},
      create: async () => ({ show(data) { window.mapPlaces = data.places; }, select() {}, resize() {}, setPoi() {} }),
    },
    fetch: async (url, init) => {
      if (url.endsWith("/api/health")) return new Response('{"status":"ok"}');
      requests.push({ url, ...init, payload: JSON.parse(init.body) });
      const next = responses ? responses.shift() : { body, status };
      const response = typeof next === "function" ? await next() : next;
      return new Response(JSON.stringify(response.body), { status: response.status || 200 });
    },
  };
  const context = vm.createContext({
    window, document, Node: Element, URLSearchParams, URL, Response, AbortController, DOMException,
    setTimeout, clearTimeout,
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
    setInterval: clock ? (fn) => { clock.tick = fn; return 1; } : setInterval,
    clearInterval: clock ? () => {} : clearInterval,
    requestAnimationFrame: (fn) => fn(),
    navigator: { language: lang }, localStorage: { getItem: () => null, setItem() {} },
    history: { pushState: (_, __, hash) => { window.location.hash = hash; }, replaceState: (_, __, hash) => { window.location.hash = hash; } },
  });
  const load = (name) => vm.runInContext(read(name), context, { filename: name });
  ["js/config.js", "js/i18n.js", "js/api.js", "js/render.js"].forEach(load);
  if (main) { load("js/main.js"); document.dispatch("DOMContentLoaded"); }
  return {
    window, document, requests, load,
    route(hash) { window.location.hash = hash; for (const fn of events.hashchange || []) fn(); },
    async search() {
      document.getElementById("query").value = "Cafe nearby";
      document.getElementById("center-btn").dispatch("click");
      document.getElementById("search-form").dispatch("submit");
      await new Promise(setImmediate);
    },
  };
}

test("preserves new nullable metadata and marks HTTP 200 template responses degraded", async () => {
  const b = browser();
  const result = await b.window.Api.getRecommendations({ query: "cafe" });
  assert.equal(result.degraded, true);
  assert.equal(result.language, "ru");
  assert.deepEqual(JSON.parse(JSON.stringify(result.query_context)), fixture().query_context);
  for (const field of ["status_note", "generated_by", "is_open_now", "budget_warning", "wheelchair", "accessibility", "phone", "website", "wikidata"]) {
    assert.equal(result.recommendations[0][field], fixture().recommendations[0][field], field);
  }
});

test("does not mark Gemini-only or empty HTTP 200 responses degraded", async () => {
  const gemini = fixture();
  gemini.recommendations[0].generated_by = "gemini";
  for (const body of [gemini, fixture({ recommendations: [] })]) {
    const result = await browser({ body }).window.Api.getRecommendations({});
    assert.equal(result.degraded, false);
  }
});

test("sanitizes malformed new fields without turning false into unknown", async () => {
  const body = fixture({ language: "en", query_context: [] });
  Object.assign(body.recommendations[0], {
    generated_by: "made_up", status_note: {}, budget_warning: [], is_open_now: false,
    accessibility: {}, phone: 123, website: false, wikidata: [],
  });
  const result = await browser({ body }).window.Api.getRecommendations({});
  assert.equal(result.language, null);
  assert.equal(result.query_context, null);
  assert.equal(result.recommendations[0].is_open_now, false);
  for (const field of ["generated_by", "status_note", "budget_warning", "accessibility", "phone", "website", "wikidata"]) {
    assert.equal(result.recommendations[0][field], null, field);
  }
});

for (const [lang, expected] of [["ru", "ru"], ["kk", "kk"], ["en", "ru"]]) {
  test("real form sends supported API language for " + lang + " UI without unsupported accessibility", async () => {
    const b = browser({ lang, main: true });
    b.document.getElementById("a11y-wheelchair").checked = true;
    await b.search();
    assert.equal(b.requests.length, 1);
    assert.equal(b.requests[0].payload.language, expected);
    assert.equal("accessibility" in b.requests[0].payload, false);
    assert.equal(b.requests[0].payload.transport, "walking");
    if (lang === "en") assert.match(b.document.getElementById("results-state").textContent, /Russian/);
  });
}

test("cards and details show provenance, budget warning and qualified closed status", async () => {
  const b = browser({ main: true });
  await b.search();
  const cardText = b.document.getElementById("place-list").textContent;
  assert.match(cardText, /шаблон/i);
  assert.doesNotMatch(cardText, /Совет AI/);
  assert.match(cardText, /Превышает ваш бюджет на 15 минут/);
  assert.match(cardText, /закрыт/i);
  assert.match(cardText, /По расписанию OpenStreetMap; фактические часы уточните/);
  b.route("#/place/osm_node_123");
  const details = b.document.getElementById("view-place").textContent;
  assert.match(details, /шаблон/i);
  assert.match(details, /Превышает ваш бюджет на 15 минут/);
  assert.match(details, /закрыт/i);
  assert.match(details, /По расписанию OpenStreetMap; фактические часы уточните/);
});

test("language switch keeps the actual response language visible in results and details", async () => {
  const b = browser({ main: true });
  await b.search();
  b.window.I18N.set("kk");
  assert.match(b.document.getElementById("results-state").textContent, /орыс/);
  b.route("#/place/osm_node_123");
  assert.match(b.document.getElementById("view-place").textContent, /орыс/);
  assert.equal(b.requests.length, 1, "switching UI language must not silently send another request");
});

test("mock reports its actual Russian template language even when kk was requested", async () => {
  const b = browser({ lang: "kk", search: "&mock=1" });
  b.load("js/mock-data.js");
  const result = await b.window.Api.getRecommendations({
    latitude: 51.09, longitude: 71.42, query: "Coffee", duration_minutes: 30,
    transport: "walking", categories: ["cafe"], language: "kk",
  });
  assert.equal(result.language, "ru");
  assert.equal(result.degraded, true);
  assert.equal(result.query_context.duration_minutes, 30);
  assert.equal(result.recommendations[0].generated_by, "fallback_template");
});


test("unknown raw wheelchair tags cannot inherit object properties or claim access", async () => {
  const body = fixture();
  body.recommendations[0].wheelchair = "__proto__";
  const b = browser({ body });
  const result = await b.window.Api.getRecommendations({});
  assert.equal(result.recommendations[0].wheelchair, "__proto__");
  const card = b.window.Render.placeCard(result.recommendations[0], { askedWheelchair: true });
  assert.match(card.textContent, /Нет данных о доступности/);
  assert.doesNotMatch(card.textContent, /\[object Object\]/);
});

test("mock language notice explains fixed-language fixtures instead of promising translation on retry", async () => {
  const b = browser({ lang: "kk", search: "&mock=1", main: true });
  b.load("js/mock-data.js");
  await b.search();
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.match(b.document.getElementById("results-state").textContent, /Демо түсіндірмелері орыс/);
});


test("real API accessibility hint states its limits before searching and after language changes", () => {
  const b = browser({ main: true });
  const hint = () => b.document.getElementById("a11y-hint").textContent;
  assert.match(hint(), /не учитыва/);
  assert.match(hint(), /OSM/);
  assert.doesNotMatch(hint(), /Учитываем при подборе/);
  b.window.I18N.set("kk");
  assert.match(hint(), /ескерілмейді/);
  assert.match(hint(), /OSM/);
  b.window.I18N.set("en");
  assert.match(hint(), /not used/);
  assert.match(hint(), /OSM/);
  assert.equal(b.requests.length, 0);
});

test("mock keeps the supported accessibility hint before searching", () => {
  const b = browser({ main: true, search: "&mock=1" });
  assert.match(b.document.getElementById("a11y-hint").textContent, /Учитываем при подборе/);
  b.window.I18N.set("en");
  assert.match(b.document.getElementById("a11y-hint").textContent, /We use it when picking places/);
});


const settle = () => new Promise(setImmediate);
const page = (ids, has_more = true) => fixture({
  has_more,
  recommendations: ids.map((id) => ({ ...fixture().recommendations[0], id, name: "Place " + id })),
});
const cardIds = (b) => b.document.getElementById("place-list").children.map((node) => node.getAttribute("data-id"));
const more = (b) => b.document.getElementById("load-more");

test("pagination appends unique cards and keeps the initial search payload when the form changes", async () => {
  const b = browser({ main: true, responses: [
    { body: page(["one", "two", "three"]) },
    { body: page(["three", "four", "five"]) },
    { body: page(["six"], false) },
  ] });
  b.document.getElementById("category-cafe").checked = true;
  await b.search();
  const original = structuredClone(b.requests[0].payload);
  b.document.getElementById("query").value = "Completely different request";
  b.document.getElementById("category-cafe").checked = false;
  b.document.getElementById("duration-30").checked = true;
  b.document.getElementById("manual-lat").value = "50";
  b.document.getElementById("manual-lon").value = "70";
  b.document.getElementById("manual-apply").dispatch("click");
  b.window.I18N.set("kk");
  const firstCard = b.document.getElementById("place-list").children[0];
  assert.ok(more(b), "the recommendations need a load-more action");
  more(b).dispatch("click");
  await settle();
  assert.deepEqual(b.requests[1].payload, { ...original, exclude_ids: ["one", "two", "three"] });
  assert.deepEqual(cardIds(b), ["one", "two", "three", "four", "five"]);
  assert.equal(b.document.getElementById("place-list").children[0], firstCard, "existing cards stay mounted during append");
  more(b).dispatch("click");
  await settle();
  assert.deepEqual(b.requests[2].payload.exclude_ids, ["one", "two", "three", "four", "five"]);
  assert.deepEqual(cardIds(b), ["one", "two", "three", "four", "five", "six"]);
  assert.equal(more(b).hidden, true);
  b.route("#/place/six");
  assert.match(b.document.getElementById("view-place").textContent, /Place six/);
});

test("pagination blocks duplicate clicks and ignores a late page after a new search", async () => {
  let resolvePage;
  const pending = new Promise((resolve) => { resolvePage = resolve; });
  const b = browser({ main: true, responses: [
    { body: page(["old"]) }, () => pending, { body: page(["fresh"], false) },
  ] });
  await b.search();
  assert.ok(more(b));
  more(b).dispatch("click");
  more(b).dispatch("click");
  assert.equal(more(b).disabled, true);
  assert.equal(b.requests.length, 2);
  await b.search();
  assert.deepEqual(cardIds(b), ["fresh"]);
  assert.equal("exclude_ids" in b.requests[2].payload, false);
  resolvePage({ body: page(["stale"]) });
  await settle();
  assert.deepEqual(cardIds(b), ["fresh"]);
  assert.equal(more(b).hidden, true);
});

test("a failed page preserves cards and retries the same exclusions", async () => {
  const b = browser({ main: true, responses: [
    { body: page(["one"]) }, { status: 500, body: { error: { code: "internal" } } },
    { body: page(["two"], false) },
  ] });
  await b.search();
  assert.ok(more(b));
  more(b).dispatch("click");
  await settle();
  assert.deepEqual(cardIds(b), ["one"]);
  assert.equal(more(b).disabled, false);
  assert.match(b.document.getElementById("load-more-status").textContent, /Не удалось/);
  more(b).dispatch("click");
  await settle();
  assert.deepEqual(b.requests[2].payload, b.requests[1].payload);
  assert.deepEqual(cardIds(b), ["one", "two"]);
});

for (const ids of [[], ["one"]]) {
  test("a page with no unseen cards stops further requests: " + JSON.stringify(ids), async () => {
    const b = browser({ main: true, responses: [{ body: page(["one"]) }, { body: page(ids, true) }] });
    await b.search();
    assert.ok(more(b));
    more(b).dispatch("click");
    await settle();
    assert.deepEqual(cardIds(b), ["one"]);
    assert.equal(more(b).hidden, true);
    more(b).dispatch("click");
    assert.equal(b.requests.length, 2);
  });
}

test("API normalizes pagination and allows only the category's local illustration URL", async () => {
  const body = page(["one"]);
  body.recommendations[0].image_url = "/assets/icons/lc-coffee.svg";
  const good = await browser({ body }).window.Api.getRecommendations({});
  assert.equal(good.has_more, true);
  assert.equal(good.recommendations[0].image_url, "/assets/icons/lc-coffee.svg");
  for (const value of ["https://example.com/photo.jpg", "//example.com/a.svg", "/assets/icons/../../secret", "/assets/icons/lc-trees.svg", {}, null]) {
    body.recommendations[0].image_url = value;
    body.has_more = "true";
    const result = await browser({ body }).window.Api.getRecommendations({});
    assert.equal(result.has_more, false);
    assert.equal(result.recommendations[0].image_url, null);
  }
});

test("category illustrations use local SVGs, localized labels and a safe unknown fallback", () => {
  const cases = [
    ["cafe", "lc-coffee.svg"], ["restaurant", "lc-utensils.svg"], ["park", "lc-trees.svg"],
    ["museum", "lc-landmark.svg"], ["attraction", "lc-camera.svg"], ["viewpoint", "lc-binoculars.svg"],
    ["playground", "lc-baby.svg"], ["internal_4711", "lc-map-pin.svg"],
  ];
  for (const lang of ["ru", "kk", "en"]) {
    const b = browser({ lang });
    for (const [category, filename] of cases) {
      const visual = b.window.Render.placeVisual({ category, image_url: "https://example.com/photo.jpg" });
      const image = visual.querySelector(".place-visual__icon");
      assert.equal(image.getAttribute("src"), "assets/icons/" + filename);
      assert.ok(image.getAttribute("alt"));
      assert.equal(visual.getAttribute("aria-hidden"), null);
      assert.doesNotMatch(visual.textContent + image.getAttribute("alt"), /internal_4711|https:|photo\.jpg/);
      assert.ok(fs.existsSync(path.join(root, image.getAttribute("src"))));
    }
  }
});


test("map includes appended recommendations and can select an appended card", async () => {
  const b = browser({ main: true, responses: [{ body: page(["one", "two", "three"]) }, { body: page(["four"], false) }] });
  await b.search();
  more(b).dispatch("click");
  await settle();
  b.route("#/map/four");
  await settle();
  assert.deepEqual(Array.from(b.window.mapPlaces, (p) => p.id), ["one", "two", "three", "four"]);
  assert.equal(b.document.getElementById("map-side-list").querySelector(".place-card").getAttribute("data-id"), "four");
});

test("technical names are replaced throughout cards, maps and details in the current UI language", async () => {
  const body = fixture();
  body.recommendations[0].name = "osm_node_123";
  const b = browser({ main: true, body });
  await b.search();
  assert.doesNotMatch(b.document.getElementById("place-list").textContent, /osm_node_123/);
  assert.match(b.document.getElementById("place-list").textContent, /Точное название уточняется/);
  b.route("#/map/osm_node_123");
  await settle();
  assert.equal(b.window.mapPlaces[0].name, "Точное название уточняется");
  b.route("#/place/osm_node_123");
  assert.doesNotMatch(b.document.getElementById("view-place").textContent, /osm_node_123/);
  assert.doesNotMatch(b.document.title, /osm_node_123/);
  b.window.I18N.set("kk");
  assert.match(b.document.getElementById("view-place").textContent, /Нақты атауы нақтылануда/);
  b.window.I18N.set("en");
  assert.match(b.document.getElementById("view-place").textContent, /Exact name to be confirmed/);
});

test("display names reject code-only labels without removing brands that include digits", () => {
  const b = browser();
  const rejected = ["", "12345", "№ 123", "---", "node/123", "way 456", "relation:789", "id=123", "ref-123", "T34-85", "Т-34–85", "Ｔ３４－８５"];
  for (const name of rejected) {
    const card = b.window.Render.placeCard({ id: "opaque-id", name });
    assert.equal(card.querySelector(".place-card__name").textContent, "Точное название уточняется", name);
  }
  for (const name of ["Qazaq24", "Platforma8", "Fest425", "Z-1", "А8", "Назарбаев орталығы-2", "Кафе № 7"]) {
    const card = b.window.Render.placeCard({ id: "opaque-id", name });
    assert.equal(card.querySelector(".place-card__name").textContent, name);
  }
});

test("mock continuation excludes displayed IDs, stays in chosen categories and exhausts", async () => {
  const b = browser({ search: "&mock=1" });
  b.load("js/mock-data.js");
  const payload = { latitude: 51.09, longitude: 71.42, query: "walk", duration_minutes: 120, transport: "walking", categories: ["cafe", "park"], language: "ru" };
  const first = await b.window.Api.getRecommendations(payload);
  assert.equal(first.has_more, true);
  const second = await b.window.Api.getRecommendations({ ...payload, exclude_ids: first.recommendations.map((p) => p.id) });
  assert.ok(second.recommendations.length > 0);
  assert.equal(second.has_more, false);
  const all = [...first.recommendations, ...second.recommendations];
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
  assert.ok(all.every((p) => ["cafe", "park"].includes(p.category)));
  assert.ok(all.every((p) => p.image_url?.startsWith("/assets/icons/")));
});


test("rate-limited pagination keeps cards and offers retry after the cooldown", async () => {
  const clock = { now: 1000000 };
  const b = browser({ main: true, clock, responses: [
    { body: page(["one"]) }, { status: 429, body: { error: { code: "rate_limited" } } },
    { body: page(["two"], false) },
  ] });
  await b.search();
  more(b).dispatch("click");
  await settle();
  assert.deepEqual(cardIds(b), ["one"]);
  assert.equal(more(b).disabled, true);
  assert.match(more(b).textContent, /Подождите 60 с/);
  more(b).dispatch("click");
  assert.equal(b.requests.length, 2);
  clock.now += 30000;
  clock.tick();
  assert.match(more(b).textContent, /Подождите 30 с/);
  clock.now += 31000;
  clock.tick();
  assert.equal(more(b).disabled, false);
  more(b).dispatch("click");
  await settle();
  assert.deepEqual(b.requests[2].payload, b.requests[1].payload);
  assert.deepEqual(cardIds(b), ["one", "two"]);
});


test("category illustrations resolve inside a file preview and a hosted subdirectory", () => {
  const b = browser();
  const known = b.window.Render.placeVisual({ category: "cafe", image_url: "/assets/icons/lc-coffee.svg" });
  const fallback = b.window.Render.placeVisual({ category: "unknown", image_url: "https://example.com/remote.svg" });
  for (const [base, expectedPrefix] of [
    ["file:///C:/repo/index.html", "file:///C:/repo/assets/icons/"],
    ["https://example.com/smart-city/index.html", "https://example.com/smart-city/assets/icons/"],
  ]) {
    assert.equal(new URL(known.querySelector(".place-visual__icon").getAttribute("src"), base).href, expectedPrefix + "lc-coffee.svg");
    assert.equal(new URL(fallback.querySelector(".place-visual__icon").getAttribute("src"), base).href, expectedPrefix + "lc-map-pin.svg");
  }
  assert.match(known.querySelector(".place-visual__icon").getAttribute("alt"), /Иллюстрация категории: Кафе/);
  assert.match(known.textContent, /Иллюстрация категории/);
});


test("real transit stop is visible in recommendation card and details", async () => {
  const body = fixture();
  body.recommendations[0].nearest_transit_stop = {
    name: "Бәйтерек", stop_type: "lrt", distance_meters: 239.6, route_refs: null,
  };
  const b = browser({ main: true, body });
  await b.search();
  const card = b.document.getElementById("place-list").querySelector(".place-card");
  assert.match(card.textContent, /Бәйтерек/);
  assert.match(card.textContent, /ЛРТ/);
  assert.match(card.textContent, /240 м/);
  b.route("#/place/osm_node_123");
  assert.match(b.document.getElementById("view-place").textContent, /Бәйтерек/);
});

test("transit data does not invent route numbers or show a missing stop", async () => {
  const body = fixture();
  body.recommendations[0].nearest_transit_stop = {
    name: null, stop_type: "bus", distance_meters: 111.2, route_refs: null,
  };
  const b = browser({ body });
  const place = (await b.window.Api.getRecommendations({})).recommendations[0];
  assert.equal(place.nearest_transit_stop.route_refs, null);
  const card = b.window.Render.placeCard(place);
  assert.match(card.textContent, /Автобусная остановка/);
  assert.doesNotMatch(card.textContent, /маршрут №/i);
  body.recommendations[0].nearest_transit_stop = null;
  const absent = (await browser({ body }).window.Api.getRecommendations({})).recommendations[0];
  assert.doesNotMatch(b.window.Render.placeCard(absent).textContent, /Ближайшая остановка/);
});

test("malformed transit metadata is discarded by the browser", async () => {
  const body = fixture();
  body.recommendations[0].nearest_transit_stop = {
    name: { unsafe: true }, stop_type: "bus", distance_meters: -1, route_refs: 12,
  };
  const place = (await browser({ body }).window.Api.getRecommendations({})).recommendations[0];
  assert.equal(place.nearest_transit_stop, null);
});
