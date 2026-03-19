export function map_init({
  elId = "map",
  defaultCenter = [42.27, -71.8],
  defaultZoom = 13,
} = {}) {
  if (!window.L) throw new Error("Leaflet (window.L) not found. Make sure Leaflet is loaded before app.js.");

  const map = L.map(elId, { zoomControl: true }).setView(defaultCenter, defaultZoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  const state = { marker: null, accuracyCircle: null };

  function setMarker({ lat, lng, accuracyMeters }) {
    const ll = [lat, lng];
    if (!state.marker) {
      // Use a circleMarker so the visual is exactly centered on the coordinate
      // (and doesn't depend on external icon assets).
      state.marker = L.circleMarker(ll, {
        radius: 7,
        color: "#1b1b1b",
        weight: 2,
        fillColor: "#2b6cb0",
        fillOpacity: 0.65,
      }).addTo(map);
    } else {
      state.marker.setLatLng(ll);
    }

    if (typeof accuracyMeters === "number" && Number.isFinite(accuracyMeters)) {
      if (!state.accuracyCircle) {
        state.accuracyCircle = L.circle(ll, {
          radius: accuracyMeters,
          color: "#1b1b1b",
          weight: 2,
          fillColor: "#2b6cb0",
          fillOpacity: 0.10,
        }).addTo(map);
      } else {
        state.accuracyCircle.setLatLng(ll);
        state.accuracyCircle.setRadius(accuracyMeters);
      }
    }
  }

  async function locateOnce() {
    if (!navigator.geolocation) return { ok: false, reason: "geolocation unsupported" };
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          setMarker({ lat: latitude, lng: longitude, accuracyMeters: accuracy });
          map.setView([latitude, longitude], Math.max(defaultZoom, 18), { animate: true });
          resolve({
            ok: true,
            text: `${latitude.toFixed(5)}, ${longitude.toFixed(5)} ±${Math.round(accuracy)}m`,
          });
        },
        (err) => resolve({ ok: false, reason: err?.message || "geolocation denied" }),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  function startTracking({ onUpdate } = {}) {
    if (!navigator.geolocation) return { ok: false, reason: "geolocation unsupported" };

    let watchState = {
      lastLatLng: null,
      lastRecenterAt: 0,
    };

    function distMeters(a, b) {
      // Haversine formula for meters.
      const R = 6371000;
      const toRad = (deg) => (deg * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setMarker({ lat: latitude, lng: longitude, accuracyMeters: accuracy });

        const now = Date.now();
        const curr = { lat: latitude, lng: longitude };
        const moved = watchState.lastLatLng ? distMeters(watchState.lastLatLng, curr) : Infinity;

        // Recentre often enough for "follow me", but not so often that it jitters.
        // If you're moving, recenter when movement is meaningful; otherwise every ~2s.
        if (
          now - watchState.lastRecenterAt > 2000 ||
          moved > 10 ||
          accuracy < 40 // good fix: recenter
        ) {
          map.setView([latitude, longitude], Math.max(defaultZoom, 18), { animate: true });
          watchState.lastRecenterAt = now;
        }
        watchState.lastLatLng = curr;

        onUpdate?.({
          ok: true,
          lat: latitude,
          lng: longitude,
          accuracy,
          text: `${latitude.toFixed(5)}, ${longitude.toFixed(5)} ±${Math.round(accuracy)}m`,
        });
      },
      (err) => onUpdate?.({ ok: false, reason: err?.message || "geolocation denied" }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );

    return {
      ok: true,
      stop: () => navigator.geolocation.clearWatch(watchId),
    };
  }

  // Leaflet needs a size invalidation if map is created in a flex/grid container.
  const invalidate = () => map.invalidateSize();
  setTimeout(invalidate, 0);
  setTimeout(invalidate, 250);
  window.addEventListener("resize", invalidate);
  window.addEventListener("scroll", invalidate, { passive: true });

  function onClick(cb) {
    if (typeof cb !== "function") return () => {};
    const handler = (e) => {
      const { lat, lng } = e.latlng;
      cb({ lat, lng, event: e });
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }

  return { map, locateOnce, startTracking, onClick };
}

export function route_map_init({
  elId = "routeMap",
  defaultCenter = [42.27, -71.8],
  defaultZoom = 13,
} = {}) {
  if (!window.L) throw new Error("Leaflet (window.L) not found. Make sure Leaflet is loaded before app.js.");

  const map = L.map(elId, { zoomControl: true }).setView(defaultCenter, defaultZoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  let polyline = null;
  let startMarker = null;
  let endMarker = null;

  function clear() {
    if (polyline) {
      map.removeLayer(polyline);
      polyline = null;
    }
    if (startMarker) {
      map.removeLayer(startMarker);
      startMarker = null;
    }
    if (endMarker) {
      map.removeLayer(endMarker);
      endMarker = null;
    }
  }

  function renderRoute(points) {
    clear();
    if (!Array.isArray(points) || points.length < 2) {
      map.setView(defaultCenter, defaultZoom);
      return;
    }

    const latlngs = points.map((p) => [p.lat, p.lng]);
    polyline = L.polyline(latlngs, { color: "#2b6cb0", weight: 4, opacity: 0.8 }).addTo(map);

    const start = points[0];
    const end = points[points.length - 1];

    startMarker = L.circleMarker([start.lat, start.lng], {
      radius: 8,
      color: "#1b1b1b",
      weight: 2,
      fillColor: "#2f855a",
      fillOpacity: 0.85,
    }).addTo(map);

    endMarker = L.circleMarker([end.lat, end.lng], {
      radius: 8,
      color: "#1b1b1b",
      weight: 2,
      fillColor: "#b83280",
      fillOpacity: 0.85,
    }).addTo(map);

    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  const invalidate = () => map.invalidateSize();
  setTimeout(invalidate, 0);
  setTimeout(invalidate, 250);
  window.addEventListener("resize", invalidate);

  return { map, renderRoute, clear };
}