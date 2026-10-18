/*
 * Все места города для слоя на экране «Карта».
 * Источник: GET /api/poi у бекенда (предложение к контракту, флаг POI_ENDPOINT)
 * или снимок OpenStreetMap data/poi-astana.json (tools/build_poi_snapshot.py).
 * Фильтр «вокруг» считается по прямой (Haversine), как у бекенда.
 */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  let all = null; // кеш всего города

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371008.8;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const VALID = new Set(CFG.CATEGORIES.map((c) => c.value));

  function clean(list) {
    return list
      .filter((p) => p && typeof p.name === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && VALID.has(p.category))
      .map((p) => ({ id: String(p.id), name: p.name, lat: p.lat, lon: p.lon, category: p.category }));
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadAll() {
    if (all) return all;
    if (CFG.FEATURES.POI_ENDPOINT) {
      const data = await fetchJson(`${CFG.API_BASE_URL}/api/poi?limit=${CFG.POI_LIMIT}`);
      all = {
        source: "api",
        places: clean((data.places || []).map((p) => ({ id: p.id, name: p.name, lat: p.latitude, lon: p.longitude, category: p.category }))),
      };
    } else {
      const data = await fetchJson(CFG.POI_SNAPSHOT_URL);
      all = {
        source: "snapshot",
        collectedAt: typeof data.collected_at === "string" ? data.collected_at : null,
        places: clean((data.places || []).map(([id, name, lat, lon, category]) => ({ id, name, lat, lon, category }))),
      };
    }
    return all;
  }

  /** Места в радиусе от точки, ближние первыми. */
  function around(places, center, radius) {
    return places
      .map((p) => ({ ...p, distance: haversine(center.lat, center.lon, p.lat, p.lon) }))
      .filter((p) => p.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
  }

  window.Poi = Object.freeze({ loadAll, around, haversine });
})();
