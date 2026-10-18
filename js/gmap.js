/*
 * Google Карты без ключа API: встраиваемая карта (iframe) с меткой по координатам.
 * В Google передаются только координаты места или название города —
 * координаты пользователя туда не отправляются.
 */
(function () {
  "use strict";

  function embedUrl({ lat, lon, query, zoom = 16 }) {
    const q = query ? encodeURIComponent(query) : `${lat.toFixed(6)},${lon.toFixed(6)}`;
    return `https://maps.google.com/maps?q=${q}&hl=ru&z=${zoom}&output=embed`;
  }

  function placeUrl(lat, lon) {
    return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
  }

  // Маршрут строит сам Google: передаём только точку назначения.
  function routeUrl(lat, lon) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=walking`;
  }

  /**
   * @param {HTMLElement} container
   * @param {{size?: string, title?: string}} options
   */
  function create(container, { size = "compact", title = "Google Карта" } = {}) {
    container.classList.add("gmap", `gmap--${size}`);
    const iframe = document.createElement("iframe");
    iframe.className = "gmap__frame";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.title = title;
    iframe.setAttribute("allowfullscreen", "");
    container.prepend(iframe);

    return {
      show(opts, frameTitle) {
        const src = embedUrl(opts);
        if (iframe.getAttribute("src") !== src) iframe.setAttribute("src", src);
        if (frameTitle) iframe.title = frameTitle;
      },
    };
  }

  window.GMap = Object.freeze({ create, embedUrl, placeUrl, routeUrl });
})();
