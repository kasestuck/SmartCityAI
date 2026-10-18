/*
 * Карта мест на экране «Карта»: все места подборки сразу (Leaflet + OpenStreetMap).
 * Нумерованные метки с иконкой категории, точка отправления и ориентиры Астаны.
 * Данные мест выводятся через DOM-узлы (textContent), без HTML-строк с данными сервера.
 */
(function () {
  "use strict";

  const ICONS = "assets/icons/";

  // Цвета точек слоя «все места» по категориям (легенда — в main.js).
  const CATEGORY_COLORS = {
    cafe: "#a0582a",
    restaurant: "#b23a3a",
    park: "#2e7d4f",
    museum: "#5b4fa0",
    attraction: "#2f6aa8",
    viewpoint: "#17808f",
    playground: "#b07d00",
  };

  function placeIcon(L, { index, iconName, selected }) {
    const root = document.createElement("span");
    root.className = "pm-marker" + (selected ? " is-selected" : "");
    const img = document.createElement("img");
    img.src = ICONS + iconName;
    img.width = 18;
    img.height = 18;
    img.alt = "";
    const num = document.createElement("span");
    num.className = "pm-marker__num";
    num.textContent = String(index);
    root.append(img, num);
    return L.divIcon({ className: "pm-marker-wrap", html: root, iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22] });
  }

  /**
   * @param {HTMLElement} container
   * @param {{onSelect(id), onDetails(id), t(key, vars)}} opts
   */
  async function create(container, opts) {
    const PM = window.PickMap;
    const L = await PM.loadLeaflet();
    container.classList.add("placesmap");
    const map = L.map(container, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    L.tileLayer(PM.TILES, { maxZoom: 19, attribution: PM.ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(false);

    const canvas = L.canvas({ padding: 0.3 });
    const poiLayer = L.layerGroup().addTo(map);
    let radiusCircle = null;
    const landmarkLayer = L.layerGroup().addTo(map);
    const placeLayer = L.layerGroup().addTo(map);
    let startMarker = null;
    let markers = new Map(); // id → { marker, place, index, iconName }
    let selectedId = null;

    function popupContent(place, cat) {
      const box = document.createElement("div");
      box.className = "pm-popup";
      const c = document.createElement("p");
      c.className = "pm-popup__cat";
      c.textContent = cat;
      const name = document.createElement("p");
      name.className = "pm-popup__name";
      name.textContent = place.name;
      const meta = document.createElement("p");
      meta.className = "pm-popup__meta";
      meta.textContent = place.meta || "";
      const btn = document.createElement("a");
      btn.className = "pm-popup__link";
      btn.href = `#/place/${encodeURIComponent(place.id)}`;
      btn.textContent = opts.t("details");
      box.append(c, name);
      if (place.meta) box.append(meta);
      box.append(btn);
      return box;
    }

    function setLandmarks(list) {
      landmarkLayer.clearLayers();
      for (const lm of list) {
        L.circleMarker([lm.lat, lm.lon], {
          radius: 5,
          color: "#ffffff",
          weight: 2,
          fillColor: "#59675f",
          fillOpacity: 0.9,
          keyboard: false,
        })
          .bindTooltip(lm.name, { direction: "top", offset: [0, -6], className: "pm-tooltip" })
          .addTo(landmarkLayer);
      }
    }

    function refreshIcons() {
      for (const [id, m] of markers) {
        m.marker.setIcon(placeIcon(L, { index: m.index, iconName: m.iconName, selected: id === selectedId }));
        m.marker.setZIndexOffset(id === selectedId ? 1000 : 0);
      }
    }

    const api = {
      /**
       * @param {{places: Array<{id,name,lat,lon,iconName,category,meta}>, start, selectedId, landmarks}} data
       */
      show({ places, start, selectedId: sel, landmarks }) {
        map.invalidateSize();
        placeLayer.clearLayers();
        markers = new Map();
        selectedId = sel || null;
        setLandmarks(landmarks || []);

        if (startMarker) startMarker.remove();
        startMarker = null;
        if (start) {
          startMarker = L.marker([start.lat, start.lon], {
            icon: PM.meIcon(L, false),
            keyboard: false,
            title: opts.t("start_point"),
          })
            .bindTooltip(opts.t("start_point"), { direction: "top", offset: [0, -16], className: "pm-tooltip" })
            .addTo(map);
        }

        places.forEach((p, i) => {
          const index = i + 1;
          const marker = L.marker([p.lat, p.lon], {
            icon: placeIcon(L, { index, iconName: p.iconName, selected: p.id === selectedId }),
            keyboard: true,
            title: `${index}. ${p.name}`,
            alt: `${index}. ${p.name}`,
            riseOnHover: true,
          })
            .bindPopup(popupContent(p, p.category), { closeButton: true, autoPanPadding: [24, 24] })
            .on("click", () => opts.onSelect(p.id))
            .addTo(placeLayer);
          markers.set(p.id, { marker, place: p, index, iconName: p.iconName });
        });

        const pts = places.map((p) => [p.lat, p.lon]);
        if (start) pts.push([start.lat, start.lon]);
        if (pts.length >= 2) map.fitBounds(pts, { padding: [48, 48], maxZoom: 16 });
        else if (pts.length === 1) map.setView(pts[0], 15);
        else map.setView([51.128, 71.43], 12);

        if (selectedId && markers.has(selectedId)) markers.get(selectedId).marker.openPopup();
      },

      /**
       * Слой «все места». points: [{id,name,lat,lon,category,distance?}]
       * circle: {lat, lon, radius} | null; fitTo: массив [lat, lon] для подгонки вида.
       */
      setPoi({ points, circle, fitTo, describe }) {
        poiLayer.clearLayers();
        if (radiusCircle) radiusCircle.remove();
        radiusCircle = null;
        const recommended = new Set(markers.keys());
        for (const p of points) {
          if (recommended.has(p.id)) continue; // рекомендации уже нарисованы крупно
          L.circleMarker([p.lat, p.lon], {
            renderer: canvas,
            radius: 5,
            color: "#ffffff",
            weight: 1.5,
            fillColor: CATEGORY_COLORS[p.category] || "#59675f",
            fillOpacity: 0.9,
          })
            .bindPopup(() => describe(p), { autoPanPadding: [24, 24] })
            .addTo(poiLayer);
        }
        if (circle) {
          radiusCircle = L.circle([circle.lat, circle.lon], {
            radius: circle.radius,
            color: "#204e43",
            weight: 1.5,
            dashArray: "6 6",
            fillColor: "#204e43",
            fillOpacity: 0.05,
            interactive: false,
          }).addTo(map);
        }
        if (fitTo && fitTo.length >= 2) map.fitBounds(fitTo, { padding: [40, 40], maxZoom: 16 });
        else if (fitTo && fitTo.length === 1) map.setView(fitTo[0], 15);
      },

      select(id, { pan = true } = {}) {
        selectedId = id;
        refreshIcons();
        const m = markers.get(id);
        if (!m) return;
        if (pan) map.panTo(m.marker.getLatLng(), { animate: true });
        m.marker.openPopup();
      },

      resize() {
        map.invalidateSize();
      },
    };
    return api;
  }

  window.PlacesMap = Object.freeze({ create, CATEGORY_COLORS });
})();
