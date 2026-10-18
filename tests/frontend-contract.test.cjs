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
    ...overrides,
  };
}

function browser({ lang = "ru", body = fixture(), status = 200, search = "", main = false } = {}) {
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
    fetch: async (url, init) => {
      if (url.endsWith("/api/health")) return new Response('{"status":"ok"}');
      requests.push({ url, ...init, payload: JSON.parse(init.body) });
      return new Response(JSON.stringify(body), { status });
    },
  };
  const context = vm.createContext({
    window, document, Node: Element, URLSearchParams, URL, Response, AbortController, DOMException,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (fn) => fn(),
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
