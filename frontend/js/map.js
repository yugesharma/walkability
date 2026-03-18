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