/*
 * Построение DOM. Данные сервера выводятся только через textContent —
 * innerHTML с ними не используется (защита от XSS).
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const ICONS = "assets/icons/";

  function isPresent(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "number") return Number.isFinite(v);
    return String(v).trim() !== "";
  }

  /** el("p", {class: "x", text: "…", attrs: {...}}, ...children) */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) {
        if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (props.on) {
      for (const [ev, fn] of Object.entries(props.on)) node.addEventListener(ev, fn);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function icon(name, size, extraClass) {
    return el("img", {
      class: extraClass,
      attrs: { src: ICONS + name, width: size, height: size, alt: "" },
    });
  }

  // 650 м · 1,2 км (по прямой считает бекенд)
  function formatDistance(meters) {
    if (!isPresent(meters)) return null;
    const rounded = Math.round(meters);
    if (rounded < 1000) return `${rounded} м`;
    return `${(meters / 1000).toFixed(1).replace(".", ",")} км`;
  }

  function formatMinutes(min) {
    if (!isPresent(min)) return null;
    return `≈ ${Math.round(min)} мин`;
  }

  function formatDurationChoice(min) {
    if (min < 60) return `${min} мин`;
    const h = min / 60;
    if (h === 1) return "1 час";
    if (Number.isInteger(h)) return `${h} ${h < 5 ? "часа" : "часов"}`;
    return `${String(h).replace(".", ",")} часа`;
  }

  function pluralPlaces(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "место";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "места";
    return "мест";
  }

  function categoryInfo(value) {
    const found = CFG.CATEGORIES.find((c) => c.value === value);
    if (found) return found;
    return { value: value || "other", label: isPresent(value) ? value : "Место", emoji: "📍" };
  }

  function osmPlaceUrl(place) {
    const lat = place.latitude.toFixed(6);
    const lon = place.longitude.toFixed(6);
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  }

  // Маршрут строится на сайте OSM: передаём только точку назначения,
  // координаты пользователя третьей стороне не отправляем.
  function osmRouteUrl(place) {
    const dest = `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${encodeURIComponent(dest)}`;
  }

  function hasCoords(place) {
    return isPresent(place.latitude) && isPresent(place.longitude);
  }

  function metaLine(place) {
    const parts = [];
    const d = formatDistance(place.distance_meters);
    if (d) parts.push(`≈ ${d} по прямой`);
    const t = formatMinutes(place.estimated_duration_minutes);
    if (t) parts.push(`${t} на дорогу и визит`);
    return parts.join(" · ");
  }

  function placeVisual(place, { index, badge = true } = {}) {
    const cat = categoryInfo(place.category);
    return el(
      "div",
      { class: "place-visual", attrs: { "data-category": cat.value, "aria-hidden": "true" } },
      badge ? el("span", { class: "badge-ai" }, icon("sparkles-12.svg", 12), "Совет AI") : null,
      el("span", { class: "place-visual__emoji", text: cat.emoji }),
      index ? el("span", { class: "place-visual__num", text: String(index) }) : null
    );
  }

  function externalLink(className, href, label, srLabel, iconName) {
    return el(
      "a",
      { class: className, attrs: { href, target: "_blank", rel: "noopener noreferrer" } },
      iconName ? icon(iconName, 18) : null,
      label,
      el("span", { class: "visually-hidden", text: srLabel })
    );
  }

  /** Карточка рекомендации (макет «AI-гид · Карточка места»). */
  function placeCard(place, { index, selected = false, compactActions = false } = {}) {
    const cat = categoryInfo(place.category);
    const meta = metaLine(place);
    const card = el("article", {
      class: "place-card" + (selected ? " is-selected" : ""),
      attrs: { "aria-labelledby": `place-name-${place.id}`, "data-id": place.id },
    });

    const body = el(
      "div",
      { class: "place-card__body" },
      el(
        "div",
        { class: "place-card__heading" },
        el("p", { class: "place-card__category", text: cat.label }),
        el(
          "h3",
          { class: "place-card__name", attrs: { id: `place-name-${place.id}` } },
          el("a", { attrs: { href: `#/place/${encodeURIComponent(place.id)}` }, text: place.name })
        ),
        meta ? el("p", { class: "place-card__meta", text: meta }) : null
      ),
      isPresent(place.description) ? el("p", { class: "place-card__text", text: place.description }) : null,
      isPresent(place.reason) ? el("p", { class: "reason-box", text: place.reason }) : null,
      isPresent(place.suggested_action)
        ? el("p", { class: "place-card__text" }, el("b", { text: "Что делать: " }), place.suggested_action)
        : null,
      isPresent(place.opening_hours)
        ? el("p", { class: "place-card__text" }, el("b", { text: "Часы работы (по данным OSM): " }), place.opening_hours)
        : null
    );

    if (hasCoords(place)) {
      const actions = el("div", { class: "place-card__actions" });
      if (!compactActions) {
        actions.append(
          el(
            "a",
            { class: "btn btn--secondary", attrs: { href: `#/map/${encodeURIComponent(place.id)}` } },
            "На карте",
            el("span", { class: "visually-hidden", text: `: ${place.name}` })
          )
        );
      }
      actions.append(
        externalLink(
          "btn btn--primary",
          osmRouteUrl(place),
          "Маршрут",
          ` до «${place.name}» в OpenStreetMap (откроется в новой вкладке)`,
          "navigation-white.svg"
        )
      );
      body.append(actions);
    }

    if (isPresent(place.source)) {
      body.append(el("p", { class: "place-card__source", text: `Источник: ${place.source}` }));
    }

    card.append(placeVisual(place, { index }), body);
    return card;
  }

  /** Компактный элемент списка на экране карты. */
  function placeMini(place, { index, onSelect }) {
    const cat = categoryInfo(place.category);
    const meta = metaLine(place);
    return el(
      "button",
      {
        class: "place-mini",
        attrs: { type: "button", "data-id": place.id },
        on: { click: () => onSelect(place.id) },
      },
      placeVisual(place, { badge: false }),
      el(
        "span",
        { class: "place-mini__text" },
        el("span", { class: "place-mini__name" }, el("span", { class: "visually-hidden", text: `${index}. ` }), place.name),
        el("span", { class: "place-card__category", text: cat.label }),
        meta ? el("span", { class: "place-card__meta", text: meta }) : null
      )
    );
  }

  /** Карточка состояния (макет «Состояния интерфейса»). */
  function stateCard({ kind = "info", iconName, title, text, actions = [], extra = null }) {
    return el(
      "div",
      { class: `state-card state-card--${kind}` },
      el("div", { class: "state-card__icon", attrs: { "aria-hidden": "true" } }, icon(iconName, 24)),
      el("p", { class: "state-card__title", text: title }),
      text ? el("p", { class: "state-card__text", text }) : null,
      extra,
      actions.length ? el("div", { class: "state-card__actions" }, actions) : null
    );
  }

  function skeleton() {
    return el(
      "div",
      { class: "skeleton", attrs: { "aria-hidden": "true" } },
      el("div", { class: "skeleton__block" }),
      el(
        "div",
        { class: "skeleton__lines" },
        el("div", { class: "skeleton__line skeleton__line--short" }),
        el("div", { class: "skeleton__line skeleton__line--title" }),
        el("div", { class: "skeleton__line" }),
        el("div", { class: "skeleton__line" }),
        el("div", { class: "skeleton__line skeleton__line--short" })
      )
    );
  }

  function dots() {
    return el("div", { class: "dots", attrs: { "aria-hidden": "true" } }, el("span"), el("span"), el("span"));
  }

  window.Render = Object.freeze({
    el,
    icon,
    isPresent,
    hasCoords,
    formatDistance,
    formatMinutes,
    formatDurationChoice,
    pluralPlaces,
    categoryInfo,
    metaLine,
    osmPlaceUrl,
    osmRouteUrl,
    externalLink,
    placeVisual,
    placeCard,
    placeMini,
    stateCard,
    skeleton,
    dots,
  });
})();
