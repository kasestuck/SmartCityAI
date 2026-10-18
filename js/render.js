/*
 * Построение DOM. Данные сервера выводятся только через textContent —
 * innerHTML с ними не используется (защита от XSS).
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const I = window.I18N;
  const t = I.t;
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
    if (rounded < 1000) return t("unit_m", { n: rounded });
    return t("unit_km", { n: I.decimal(meters / 1000) });
  }

  function formatMinutes(min) {
    if (!isPresent(min)) return null;
    return t("min_approx", { n: Math.round(min) });
  }

  function formatDurationChoice(min) {
    if (min < 60) return t("dur_min", { n: min });
    const h = min / 60;
    if (h === 1) return t("dur_hour");
    return t("dur_hours", { n: Number.isInteger(h) ? h : I.decimal(h) });
  }

  function pluralPlaces(n) {
    return I.places(n);
  }

  function categoryInfo(value) {
    const found = CFG.CATEGORIES.find((c) => c.value === value);
    if (found) return { value, icon: found.icon, label: t(`cat_${value}`), chip: t(`chip_${value}`) };
    return { value: value || "other", label: isPresent(value) ? value : t("cat_other"), chip: value, icon: "lc-map-pin.svg" };
  }

  // Google Карты: передаём только координаты места, не пользователя.
  function placeUrl(place) {
    return window.GMap.placeUrl(place.latitude, place.longitude);
  }

  function routeUrl(place) {
    return window.GMap.routeUrl(place.latitude, place.longitude);
  }

  function hasCoords(place) {
    return isPresent(place.latitude) && isPresent(place.longitude);
  }

  function metaLine(place) {
    const parts = [];
    const d = formatDistance(place.distance_meters);
    if (d) parts.push(t("meta_dist", { d }));
    const m = formatMinutes(place.estimated_duration_minutes);
    if (m) parts.push(t("meta_time", { t: m }));
    return parts.join(" · ");
  }

  function placeVisual(place, { index, badge = true } = {}) {
    const cat = categoryInfo(place.category);
    return el(
      "div",
      { class: "place-visual", attrs: { "data-category": cat.value, "aria-hidden": "true" } },
      badge && ["gemini", "fallback_template"].includes(place.generated_by)
        ? el("span", { class: "badge-ai" }, icon("sparkles-12.svg", 12), t(place.generated_by === "gemini" ? "ai_tip" : "template_tip"))
        : null,
      icon(cat.icon, 40, "place-visual__icon"),
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

  // Доступность для коляски — только из тега OSM wheelchair, без догадок.
  const WHEELCHAIR = { yes: "a11y_wc_yes", limited: "a11y_wc_limited", no: "a11y_wc_no" };

  function accessibilityText(place, asked) {
    const key = Object.hasOwn(WHEELCHAIR, place.wheelchair) ? WHEELCHAIR[place.wheelchair] : null;
    if (key) return t(key);
    return asked ? t("a11y_wc_unknown") : null;
  }

  function accessibilityBadge(place, asked) {
    const text = accessibilityText(place, asked);
    if (!text) return null;
    const level = Object.hasOwn(WHEELCHAIR, place.wheelchair) ? place.wheelchair : "unknown";
    return el("p", { class: `a11y-badge a11y-badge--${level}` }, icon("lc-accessibility.svg", 16), text);
  }

  function generationText(place) {
    if (place.generated_by === "gemini") return t("generation_gemini");
    if (place.generated_by === "fallback_template") return t("generation_template");
    return t("generation_unknown");
  }

  function openingStatusText(place) {
    const note = isPresent(place.status_note) ? place.status_note : t("status_check");
    if (typeof place.is_open_now === "boolean") {
      return t(place.is_open_now ? "status_open" : "status_closed") + " " + note;
    }
    return isPresent(place.status_note) ? place.status_note : t("status_unknown");
  }

  /** Карточка рекомендации (макет «AI-гид · Карточка места»). */
  function placeCard(place, { index, selected = false, compactActions = false, askedWheelchair = false } = {}) {
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
      accessibilityBadge(place, askedWheelchair),
      isPresent(place.budget_warning) ? el("p", { class: "notice", text: place.budget_warning }) : null,
      el("p", { class: "place-card__source", text: generationText(place) }),
      isPresent(place.description) ? el("p", { class: "place-card__text", text: place.description }) : null,
      isPresent(place.reason) ? el("p", { class: "reason-box", text: place.reason }) : null,
      isPresent(place.suggested_action)
        ? el("p", { class: "place-card__text" }, el("b", { text: t("what_to_do") }), place.suggested_action)
        : null,
      isPresent(place.opening_hours)
        ? el("p", { class: "place-card__text" }, el("b", { text: t("hours_osm") }), place.opening_hours)
        : null,
      el("p", { class: "place-card__text", text: openingStatusText(place) })
    );

    if (hasCoords(place)) {
      const actions = el("div", { class: "place-card__actions" });
      if (!compactActions) {
        actions.append(
          el(
            "a",
            { class: "btn btn--secondary", attrs: { href: `#/map/${encodeURIComponent(place.id)}` } },
            t("on_map"),
            el("span", { class: "visually-hidden", text: `: ${place.name}` })
          )
        );
      }
      actions.append(
        externalLink(
          "btn btn--primary",
          routeUrl(place),
          t("route"),
          t("route_sr", { name: place.name }),
          "navigation-white.svg"
        )
      );
      body.append(actions);
    }

    if (isPresent(place.source)) {
      body.append(el("p", { class: "place-card__source", text: t("source", { s: place.source }) }));
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
    accessibilityText,
    generationText,
    openingStatusText,
    pluralPlaces,
    categoryInfo,
    metaLine,
    placeUrl,
    routeUrl,
    externalLink,
    placeVisual,
    placeCard,
    placeMini,
    stateCard,
    skeleton,
    dots,
  });
})();
