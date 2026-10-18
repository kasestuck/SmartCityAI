/*
 * Карта для выбора точки отправления: Leaflet с CDN (без npm) + тайлы OpenStreetMap. Загружается только при открытии диалога.
 * Клик по карте → координаты; запросы к тайлам не содержат данных пользователя,
 * кроме видимой области карты.
 */
(function () {
  "use strict";

  const LEAFLET = {
    css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
    cssSri: "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==",
    js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
    jsSri: "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==",
  };

  // Стандартные тайлы OpenStreetMap: без ключа, с обязательной атрибуцией.
  const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const ATTRIBUTION =
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

  let loading = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET.css;
      link.integrity = LEAFLET.cssSri;
      link.crossOrigin = "anonymous";
      link.referrerPolicy = "no-referrer";
      document.head.append(link);

      const script = document.createElement("script");
      script.src = LEAFLET.js;
      script.integrity = LEAFLET.jsSri;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.onload = () => (window.L ? resolve(window.L) : reject(new Error("no L")));
      script.onerror = () => {
        loading = null;
        reject(new Error("leaflet load failed"));
      };
      document.head.append(script);
    });
    return loading;
  }

  function meIcon(L, pending) {
    return L.divIcon({
      className: "pick-marker" + (pending ? " pick-marker--pending" : ""),
      html: '<img src="assets/icons/marker-me.svg" width="56" height="56" alt="">',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  /**
   * @param {HTMLElement} container
   * @param {{center: {lat, lon}, point: {lat, lon}|null, onPick(lat, lon)}} opts
   * @returns {Promise<{show(opts), resize()}>}
   */
  async function create(container, opts) {
    const L = await loadLeaflet();
    container.classList.add("pickmap");
    const map = L.map(container, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(false);

    let marker = null;
    let onPick = opts.onPick;

    function setMarker(point, pending) {
      if (!point) {
        if (marker) marker.remove();
        marker = null;
        return;
      }
      const ll = [point.lat, point.lon];
      if (!marker) marker = L.marker(ll, { icon: meIcon(L, pending), keyboard: false, interactive: false }).addTo(map);
      else {
        marker.setLatLng(ll);
        marker.setIcon(meIcon(L, pending));
      }
    }

    map.on("click", (e) => {
      const lat = Number(e.latlng.lat.toFixed(6));
      const lon = Number(e.latlng.lng.toFixed(6));
      setMarker({ lat, lon }, true);
      if (onPick) onPick(lat, lon);
    });

    const api = {
      show({ center, point, onPick: cb }) {
        if (cb) onPick = cb;
        map.invalidateSize();
        const c = point || center;
        map.setView([c.lat, c.lon], point ? 15 : 12);
        setMarker(point, false);
      },
      center() {
        const c = map.getCenter();
        return { lat: Number(c.lat.toFixed(6)), lon: Number(c.lng.toFixed(6)) };
      },
      mark(point) {
        setMarker(point, true);
      },
    };
    api.show(opts);
    return api;
  }

  // loadLeaflet, TILES, ATTRIBUTION и meIcon переиспользует карта мест (js/placesmap.js).
  window.PickMap = Object.freeze({ create, loadLeaflet, TILES, ATTRIBUTION, meIcon });
})();
