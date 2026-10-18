/*
 * Схематичная карта на SVG без сторонних библиотек.
 * Фон (кварталы, улицы) декоративный; река, ориентиры и маркеры
 * ставятся по координатам, поэтому взаимное расположение мест верное.
 */
(function () {
  "use strict";

  const ICONS = "assets/icons/";

  // Ориентиры для подписей (приблизительно, карта схематичная).
  const LANDMARKS = [
    { name: "Хан Шатыр", lat: 51.1323, lon: 71.4036 },
    { name: "Байтерек", lat: 51.1283, lon: 71.4305 },
    { name: "Бульвар Нуржол", lat: 51.1252, lon: 71.4185 },
    { name: "Ак Орда", lat: 51.1258, lon: 71.4466 },
    { name: "Ботанический сад", lat: 51.1105, lon: 71.4120 },
    { name: "ЭКСПО", lat: 51.0890, lon: 71.4155 },
    { name: "Назарбаев Университет", lat: 51.0905, lon: 71.3985 },
    { name: "Правый берег", lat: 51.1605, lon: 71.4550 },
    { name: "Есиль", lat: 51.1465, lon: 71.4150 },
  ];

  const RIVER = [
    [51.060, 71.535], [51.090, 71.505], [51.112, 71.475], [51.123, 71.457],
    [51.133, 71.442], [51.140, 71.427], [51.144, 71.410], [51.147, 71.392],
    [51.151, 71.370], [51.158, 71.340],
  ];

  const BOULEVARD = [[51.1318, 71.4065], [51.1283, 71.4305], [51.1262, 71.4440]];
  const GARDEN = { lat: 51.1105, lon: 71.4120, dLat: 0.0035, dLon: 0.0075 };

  const DEFAULT_BOUNDS = { minLat: 51.078, maxLat: 51.170, minLon: 71.385, maxLon: 71.492 };

  let uid = 0;

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function hasCoords(p) {
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
  }

  function computeBounds(points, padRatio) {
    const pts = points.filter(hasCoords);
    if (!pts.length) return { ...DEFAULT_BOUNDS };
    let minLat = Math.min(...pts.map((p) => p.lat));
    let maxLat = Math.max(...pts.map((p) => p.lat));
    let minLon = Math.min(...pts.map((p) => p.lon));
    let maxLon = Math.max(...pts.map((p) => p.lon));
    const MIN_SPAN = 0.012;
    if (maxLat - minLat < MIN_SPAN) {
      const c = (maxLat + minLat) / 2;
      minLat = c - MIN_SPAN / 2;
      maxLat = c + MIN_SPAN / 2;
    }
    if (maxLon - minLon < MIN_SPAN * 1.6) {
      const c = (maxLon + minLon) / 2;
      minLon = c - MIN_SPAN * 0.8;
      maxLon = c + MIN_SPAN * 0.8;
    }
    const padLat = (maxLat - minLat) * padRatio;
    const padLon = (maxLon - minLon) * padRatio;
    return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLon: minLon - padLon, maxLon: maxLon + padLon };
  }

  // Подгоняем границы под пропорции контейнера, чтобы не искажать расстояния.
  function fitToAspect(b, width, height) {
    const cos = Math.cos(((b.minLat + b.maxLat) / 2) * (Math.PI / 180));
    let spanX = (b.maxLon - b.minLon) * cos;
    let spanY = b.maxLat - b.minLat;
    const aspect = width > 0 && height > 0 ? width / height : 1.6;
    if (spanX / spanY < aspect) {
      const extra = (spanY * aspect - spanX) / cos / 2;
      b = { ...b, minLon: b.minLon - extra, maxLon: b.maxLon + extra };
    } else {
      const extra = (spanX / aspect - spanY) / 2;
      b = { ...b, minLat: b.minLat - extra, maxLat: b.maxLat + extra };
    }
    return { ...b, cos };
  }

  function project(b, lat, lon) {
    const spanX = (b.maxLon - b.minLon) * b.cos;
    const spanY = b.maxLat - b.minLat;
    return {
      x: (((lon - b.minLon) * b.cos) / spanX) * 100,
      y: ((b.maxLat - lat) / spanY) * 100,
    };
  }

  function unproject(b, xPct, yPct) {
    return {
      lat: b.maxLat - (yPct / 100) * (b.maxLat - b.minLat),
      lon: b.minLon + (xPct / 100) * (b.maxLon - b.minLon),
    };
  }

  function buildBackground(id) {
    const svg = svgEl("svg", { class: "map__bg", "aria-hidden": "true", focusable: "false" });
    const defs = svgEl("defs");
    const pattern = svgEl("pattern", {
      id,
      width: "92",
      height: "72",
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(12)",
    });
    pattern.append(
      svgEl("rect", { width: "92", height: "72", style: "fill:var(--map-ground)" }),
      svgEl("rect", { x: "6", y: "8", width: "60", height: "22", rx: "4", style: "fill:var(--map-block)" }),
      svgEl("rect", { x: "6", y: "42", width: "60", height: "22", rx: "4", style: "fill:var(--map-block-green)" }),
      svgEl("rect", { x: "74", y: "0", width: "8", height: "72", style: "fill:var(--map-street)" }),
      svgEl("rect", { x: "0", y: "33", width: "92", height: "5", style: "fill:var(--map-street)" })
    );
    defs.append(pattern);
    svg.append(defs, svgEl("rect", { width: "100%", height: "100%", fill: `url(#${id})` }));
    return svg;
  }

  function categoryIcon(category) {
    return category === "park" || category === "playground" ? "marker-trees.svg" : "marker-pin.svg";
  }

  /**
   * @param {HTMLElement} container
   * @param {object} options
   *   places: [{id, name, lat, lon, category, label}]
   *   user: {lat, lon} | null
   *   selectedId, onSelect(id), pick: bool, onPick(lat, lon),
   *   size: "home" | "compact" | "large" | "pick" | "detail", ariaLabel
   */
  function create(container, options) {
    let opts = { places: [], user: null, selectedId: null, pick: false, padRatio: 0.2, ...options };
    let bounds = null;

    container.classList.add("map", `map--${opts.size || "compact"}`);
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", opts.ariaLabel || "Схематичная карта Астаны");

    const bg = buildBackground(`map-blocks-${++uid}`);
    const geo = svgEl("svg", {
      class: "map__geo",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
      focusable: "false",
    });
    const labels = document.createElement("div");
    labels.className = "map__layer";
    labels.setAttribute("aria-hidden", "true");
    const markers = document.createElement("div");
    markers.className = "map__layer";

    const north = document.createElement("span");
    north.className = "map__north";
    north.setAttribute("aria-hidden", "true");
    north.textContent = "С ↑";

    const attribution = document.createElement("span");
    attribution.className = "map__attribution";
    attribution.append("Схема · ");
    const osm = document.createElement("a");
    osm.href = window.APP_CONFIG.OSM_COPYRIGHT_URL;
    osm.target = "_blank";
    osm.rel = "noopener noreferrer";
    osm.textContent = "© OpenStreetMap contributors";
    attribution.append(osm);

    container.prepend(bg, geo, labels, markers);
    container.append(north, attribution);

    function layout() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      const points = opts.places.map((p) => ({ lat: p.lat, lon: p.lon }));
      if (hasCoords(opts.user)) points.push(opts.user);
      // Нижняя полоса под карточкой-подсказкой: маркеры туда не ставим.
      const reserve = typeof opts.reserveBottom === "function" ? opts.reserveBottom(w, h) : 0;
      const usableH = Math.max(h - reserve, h * 0.4);
      bounds = fitToAspect(
        opts.pick || !points.length ? { ...DEFAULT_BOUNDS } : computeBounds(points, opts.padRatio),
        w,
        usableH
      );
      if (usableH < h) {
        const extra = (bounds.maxLat - bounds.minLat) * ((h - usableH) / usableH);
        bounds = { ...bounds, minLat: bounds.minLat - extra };
      }

      // Река, бульвар, сад
      geo.replaceChildren();
      const toPts = (arr) =>
        arr.map(([lat, lon]) => project(bounds, lat, lon)).map((p) => `${p.x},${p.y}`).join(" ");
      const scale = opts.size === "large" || opts.size === "pick" ? 1 : 0.65;
      geo.append(
        svgEl("polyline", {
          points: toPts(RIVER),
          fill: "none",
          style: "stroke:var(--map-water)",
          "stroke-width": String(Math.round(34 * scale)),
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("polyline", {
          points: toPts(BOULEVARD),
          fill: "none",
          style: "stroke:var(--map-park)",
          "stroke-width": String(Math.round(12 * scale)),
          "stroke-linecap": "round",
          "vector-effect": "non-scaling-stroke",
        })
      );
      const g = project(bounds, GARDEN.lat, GARDEN.lon);
      const gEdge = project(bounds, GARDEN.lat + GARDEN.dLat, GARDEN.lon + GARDEN.dLon);
      geo.append(
        svgEl("ellipse", {
          cx: g.x,
          cy: g.y,
          rx: Math.abs(gEdge.x - g.x),
          ry: Math.abs(gEdge.y - g.y),
          style: "fill:var(--map-park)",
        })
      );

      // Подписи ориентиров
      labels.replaceChildren();
      const placed = [];
      for (const lm of LANDMARKS) {
        const p = project(bounds, lm.lat, lm.lon);
        if (p.x < 6 || p.x > 94 || p.y < 6 || p.y > 94) continue;
        // Пропускаем подпись, если она налезает на уже поставленную.
        const px = (p.x / 100) * w;
        const py = (p.y / 100) * h;
        const halfW = lm.name.length * 3.2 + 6;
        if (placed.some((q) => Math.abs(q.x - px) < q.halfW + halfW && Math.abs(q.y - py) < 16)) continue;
        placed.push({ x: px, y: py, halfW });
        const span = document.createElement("span");
        span.className = "map__label";
        span.style.left = `${p.x}%`;
        span.style.top = `${p.y}%`;
        span.textContent = lm.name;
        labels.append(span);
      }

      // Маркеры
      markers.replaceChildren();
      opts.places.forEach((place, i) => {
        if (!hasCoords(place)) return;
        const p = project(bounds, place.lat, place.lon);
        const selected = place.id === opts.selectedId;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "marker" + (selected ? " is-selected" : "");
        btn.dataset.id = place.id;
        btn.style.left = `${p.x}%`;
        btn.style.top = `${p.y}%`;
        btn.setAttribute("aria-pressed", String(selected));
        btn.setAttribute("aria-label", `${i + 1}. ${place.name}` + (selected ? " — выбрано" : ""));
        if (opts.pick || !opts.onSelect) btn.tabIndex = -1;
        const img = document.createElement("img");
        img.src = ICONS + categoryIcon(place.category);
        img.width = 18;
        img.height = 18;
        img.alt = "";
        btn.append(img);
        if (place.label) {
          const text = document.createElement("span");
          text.className = "marker__text";
          text.textContent = place.label;
          btn.append(text);
        }
        const num = document.createElement("span");
        num.className = "marker__num";
        num.setAttribute("aria-hidden", "true");
        num.textContent = String(i + 1);
        btn.append(num);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (opts.onSelect) opts.onSelect(place.id);
        });
        markers.append(btn);
      });

      if (hasCoords(opts.user)) {
        const p = project(bounds, opts.user.lat, opts.user.lon);
        const me = document.createElement("span");
        me.className = "marker-me" + (opts.userPending ? " marker-me--pending" : "");
        me.style.left = `${p.x}%`;
        me.style.top = `${p.y}%`;
        me.title = "Точка отправления";
        const img = document.createElement("img");
        img.src = ICONS + "marker-me.svg";
        img.width = 56;
        img.height = 56;
        img.alt = "";
        me.append(img);
        markers.append(me);
      }
    }

    function onClick(e) {
      if (!opts.pick || !bounds || !opts.onPick) return;
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const { lat, lon } = unproject(bounds, x, y);
      opts.onPick(Number(lat.toFixed(6)), Number(lon.toFixed(6)));
    }
    container.addEventListener("click", onClick);

    const ro = "ResizeObserver" in window ? new ResizeObserver(() => layout()) : null;
    if (ro) ro.observe(container);
    else window.addEventListener("resize", layout);
    layout();

    return {
      update(next) {
        opts = { ...opts, ...next };
        layout();
      },
      destroy() {
        if (ro) ro.disconnect();
        else window.removeEventListener("resize", layout);
        container.removeEventListener("click", onClick);
        container.replaceChildren();
      },
    };
  }

  window.SchematicMap = Object.freeze({ create, LANDMARKS });
})();
