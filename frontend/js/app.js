import { getEls, setStatus, showWarn, clearWarn, escapeHtml } from "./ui.js";
import { listCameras, startCamera, captureBlob } from "./camera.js";
import { inferBaseUrl, uploadFrame, startWalk, stopWalk, listWalks } from "./api.js";
import { map_init, route_map_init } from "./map.js";
const els = getEls();

let stream = null;
let timer = null;
let inFlight = false;
let locateOnce = null;
let stopTracking = null;
let lastLat = null;
let lastLng = null;
let lastAccuracy = null;
let routeMapApi = null;
let selectedWalkId = null;

function setIdle() {
  setStatus(els, "", "idle");
  els.stopBtn.disabled = true;
  els.startBtn.disabled = false;
}

async function postFrame() {
  if (inFlight) return;
  if (!stream) return;

  inFlight = true;
  setStatus(els, "ok", "capturing…");

  try {
    const blob = await captureBlob({ videoEl: els.video, canvasEl: els.canvas });
    if (!blob) throw new Error("Failed to capture frame (canvas.toBlob returned null).");

    const uploadUrl = els.endpointEl.value.trim();
    const { res, text, data } = await uploadFrame({
      uploadUrl,
      blob,
      lat: lastLat,
      lng: lastLng,
      accuracy: lastAccuracy,
    });

    els.output.textContent = JSON.stringify(data, null, 2);
    clearWarn(els.warn);

    const base = inferBaseUrl(uploadUrl);
    const latestPath = data && data.latest_result_url ? data.latest_result_url : "/latest-result";
    if (base) els.resultImg.src = `${base}${latestPath}?t=${Date.now()}`;

    setStatus(els, "ok", res.ok ? "uploaded" : `server ${res.status}`);
    if (!res.ok) {
      showWarn(
        els.warn,
        `Server returned <b>${res.status}</b>. Response:<br/><code>${escapeHtml(text).slice(0, 2000)}</code>`
      );
    }
  } catch (e) {
    setStatus(els, "bad", "error");
    showWarn(
      els.warn,
      `Couldn’t upload. If you opened this as <code>file://</code>, browsers may block camera/fetch.<br/>
       Try serving this page over HTTP (or run the backend and open from its origin).<br/><br/>
       <b>Error:</b> <code>${escapeHtml(String(e))}</code>`
    );
  } finally {
    inFlight = false;
  }
}

function startLoop() {
  const ms = Math.max(500, Number(els.intervalEl.value || 2000));
  els.stopBtn.disabled = false;
  els.startBtn.disabled = true;
  setStatus(els, "ok", "running");
  timer = setInterval(postFrame, ms);
  postFrame();
}

function stopLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  setIdle();
}

els.startBtn.addEventListener("click", async () => {
  try {
    clearWarn(els.warn);
    setStatus(els, "ok", "starting walk…");

    // Start DB session first so that frames are recorded once uploads begin.
    const uploadUrl = els.endpointEl.value.trim();
    const base = inferBaseUrl(uploadUrl);
    els.stopBtn.disabled = false;
    els.startBtn.disabled = true;
    const stopUrl = `${base}/stop-walk`;
    let walkStarted = false;

    // Start camera immediately; DB is best-effort.
    setStatus(els, "ok", "starting camera…");
    stream = await startCamera({
      videoEl: els.video,
      deviceId: els.deviceEl.value || undefined,
      existingStream: stream,
    });
    await listCameras(els.deviceEl);
    startLoop();

    if (!base) {
      setStatus(els, "bad", "backend URL missing");
      showWarn(els.warn, "Set the Upload endpoint to your backend URL on the LAN (LAN IP), then refresh walks.");
      return;
    }

    // Block localhost from phone browsers (they can't reach your computer via localhost).
    try {
      const u = new URL(base);
      if (["localhost", "127.0.0.1", "::1"].includes(u.hostname)) {
        setStatus(els, "bad", "backend URL can't be localhost on phone");
        showWarn(
          els.warn,
          "From a phone, `localhost` points to the phone itself. Use your computer's LAN IP (e.g. `http://192.168.x.x:8000/upload`)."
        );
        return;
      }
    } catch {}

    // Start walk DB session; do not block uploads if it fails.
    try {
      const { data: startData } = await startWalk({
        startWalkUrl: `${base}/start-walk`,
        lat: lastLat,
        lng: lastLng,
        accuracy: lastAccuracy,
      });
      walkStarted = true;
      if (startData && startData.walk_id) {
        els.output.textContent = JSON.stringify({ walk: startData }, null, 2);
      }
    } catch (e) {
      setStatus(els, "bad", "camera running (DB not started)");
      showWarn(
        els.warn,
        `Couldn't call <code>/start-walk</code> from the phone.<br/>Make sure the backend is reachable (LAN IP) and bound to <code>0.0.0.0</code>.<br/><br/><b>Error:</b> <code>${escapeHtml(
          String(e)
        )}</code>`
      );
    }
  } catch (e) {
    if (walkStarted) {
      try {
        await stopWalk({ stopWalkUrl: stopUrl });
      } catch {}
    }
    setStatus(els, "bad", "camera blocked");
    showWarn(
      els.warn,
      `Camera permission failed. Make sure this page is served over HTTP/HTTPS (not <code>file://</code>).<br/><br/>
       <b>Error:</b> <code>${escapeHtml(String(e))}</code>`
    );
  }
});

els.stopBtn.addEventListener("click", async () => {
  try {
    const uploadUrl = els.endpointEl.value.trim();
    const base = inferBaseUrl(uploadUrl);
    if (base) {
      const stopUrl = `${base}/stop-walk`;
      await stopWalk({ stopWalkUrl: stopUrl });
    }
  } catch {
    // Even if stop-walk fails, stop the camera loop so the UI doesn't keep uploading.
  } finally {
    stopLoop();
    setStatus(els, "ok", "stopped");
  }
});

els.deviceEl.addEventListener("change", async () => {
  if (!els.startBtn.disabled) return; // only switch while running
  try {
    stream = await startCamera({
      videoEl: els.video,
      deviceId: els.deviceEl.value || undefined,
      existingStream: stream,
    });
  } catch {}
});

(async () => {
  setIdle();

  try {
    const mapApi = map_init();
    // Separate map for visualizing a selected walk's route.
    routeMapApi = route_map_init({ elId: "routeMap" });
    locateOnce = mapApi.locateOnce;

    if (els.locText) els.locText.textContent = "tracking…";

    if (els.clickText) els.clickText.textContent = "click map →";
    mapApi.onClick(({ lat, lng }) => {
      const txt = `clicked: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (els.clickText) els.clickText.textContent = txt;
      // best-effort copy for quick reuse
      navigator.clipboard?.writeText?.(`${lat},${lng}`).catch(() => {});
    });

    // Track continuously using watchPosition.
    const t = mapApi.startTracking({
      onUpdate: (r) => {
        if (!els.locText) return;
        if (r?.ok) {
          lastLat = r.lat;
          lastLng = r.lng;
          lastAccuracy = r.accuracy;
          els.locText.textContent = r.text;
        } else {
          els.locText.textContent = r?.reason || "location blocked";
        }
      },
    });
    if (t?.ok) stopTracking = t.stop;

    // Allow pausing/resuming tracking (default is ON).
    if (els.locateBtn) {
      els.locateBtn.addEventListener("click", async () => {
        if (stopTracking) {
          stopTracking();
          stopTracking = null;
          if (els.locText) els.locText.textContent = "tracking paused";
          return;
        }

        if (els.locText) els.locText.textContent = "tracking…";
        const tt = mapApi.startTracking({
          onUpdate: (r) => {
            if (!els.locText) return;
            if (r?.ok) {
              lastLat = r.lat;
              lastLng = r.lng;
              lastAccuracy = r.accuracy;
              els.locText.textContent = r.text;
            } else {
              els.locText.textContent = r?.reason || "location blocked";
            }
          },
        });
        if (tt?.ok) stopTracking = tt.stop;
      });
    }
  } catch {
    // Map is optional; camera upload can still run without it.
  }

  // Camera init is separate from map (so the map still works on mobile HTTP).
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(els, "bad", "camera unsupported");
    showWarn(
      els.warn,
      "Camera capture isn’t available in this browser/context. The map should still work. " +
        "If you’re on iOS, try serving over HTTPS (or use a tunnel) to enable camera."
    );
    return;
  }

  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tmp.getTracks().forEach((t) => t.stop());
  } catch {}

  await listCameras(els.deviceEl);
})();

// Completed-walks viewer
els.walksBtn?.addEventListener("click", async () => {
  try {
    els.walksSummary.textContent = "Loading walks…";
    if (els.walksTableBody) els.walksTableBody.innerHTML = "";

    const uploadUrl = els.endpointEl.value.trim();
    const base = inferBaseUrl(uploadUrl) || "";
    const walksUrl = `${base}/walks`;

    if (!base) {
      els.walksSummary.textContent = "Set Upload endpoint to your backend URL (not localhost).";
      els.routeSummary.textContent = "Set Upload endpoint to your backend URL (not localhost).";
      return;
    }

    // Guide users away from using `localhost` from a phone browser.
    try {
      const u = new URL(base);
      if (["localhost", "127.0.0.1", "::1"].includes(u.hostname)) {
        els.walksSummary.textContent = "Backend URL can't be `localhost` from a phone.";
        els.routeSummary.textContent = "Use your computer's LAN IP in the Upload endpoint.";
        return;
      }
    } catch {}

    const { res, data, text } = await listWalks({ walksUrl });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);

    const overall = data?.overall_average_score;
    const walks = data?.walks || [];

    async function loadRouteForWalk(walkId) {
      if (!routeMapApi) {
        els.routeSummary.textContent = "Waiting for route map to initialize…";
        const start = Date.now();
        while (!routeMapApi && Date.now() - start < 5000) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      if (!routeMapApi) throw new Error("Route map not initialized yet.");
      if (!walkId) return;

      const routeUrl = `${base}/walks/${walkId}/route`;
      els.routeSummary.textContent = `Loading route for walk #${walkId}…`;

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 7000);
      const r = await fetch(routeUrl, { signal: controller.signal });
      clearTimeout(t);
      const txt = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 500)}`);

      const rd = JSON.parse(txt);
      const points = rd?.points || [];
      routeMapApi.renderRoute(points);

      if (!points.length) {
        els.routeSummary.textContent =
          `No route points found for walk #${walkId}. ` + "Likely lat/lng were missing.";
      } else {
        els.routeSummary.textContent = `Showing route for walk #${walkId} (${points.length} points).`;
      }
    }

    if (typeof overall === "number") {
      els.walksSummary.textContent = `Overall average score: ${overall.toFixed(2)}`;
    }

    if (!walks.length) {
      if (els.walksTableBody) {
        els.walksTableBody.innerHTML =
          '<tr><td colspan="4">No completed walks yet.</td></tr>';
      }
      if (routeMapApi) routeMapApi.clear();
      selectedWalkId = null;
    } else {
      if (els.walksTableBody) els.walksTableBody.innerHTML = "";
      const fmtTime = (iso) => {
        if (!iso) return "—";
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString();
      };

      for (const w of walks) {
        const avg = w.average_score;
        const avgText = typeof avg === "number" ? avg.toFixed(2) : "—";
        const frames = w.scored_frames ?? 0;
        const started = fmtTime(w.started_at);

        const tr = document.createElement("tr");

        const tdWalk = document.createElement("td");
        tdWalk.textContent = `#${w.walk_id}`;

        const tdStarted = document.createElement("td");
        tdStarted.textContent = started;

        const tdAvg = document.createElement("td");
        tdAvg.textContent = avgText;

        const tdFrames = document.createElement("td");
        tdFrames.textContent = String(frames);

        tr.append(tdWalk, tdStarted, tdAvg, tdFrames);

        tr.style.cursor = "pointer";
        tr.title = `Click to view route for walk #${w.walk_id}`;

        const isSelected = selectedWalkId !== null && w.walk_id === selectedWalkId;
        if (isSelected) {
          tr.style.background = "rgba(43, 108, 176, 0.14)";
        }

        tr.addEventListener("click", async () => {
          selectedWalkId = w.walk_id;

          // Re-render selection highlight
          if (els.walksTableBody) {
            Array.from(els.walksTableBody.querySelectorAll("tr")).forEach((row) => {
              row.style.background = "";
            });
          }
          tr.style.background = "rgba(43, 108, 176, 0.14)";

          try {
            await loadRouteForWalk(w.walk_id);
          } catch (e) {
            els.routeSummary.textContent = `Failed to load route: ${String(e)}`;
          }
        });

        if (els.walksTableBody) els.walksTableBody.appendChild(tr);
      }

      // Auto-select the previously selected walk if it exists; otherwise select the newest.
      const shouldSelectExisting = selectedWalkId !== null && walks.some((w) => w.walk_id === selectedWalkId);
      if (!shouldSelectExisting) selectedWalkId = walks[0].walk_id;
      await loadRouteForWalk(selectedWalkId);
    }

    els.walksSummary.textContent = `Loaded ${walks.length} walks (overall avg: ${
      typeof overall === "number" ? overall.toFixed(2) : "—"
    }).`;
  } catch (e) {
    els.walksSummary.textContent = "Failed to load walks";
    // Keep it readable even if list is already populated
    if (els.walksTableBody) els.walksTableBody.innerHTML = `<tr><td colspan="4">Failed to fetch walks.<br/><span class="tiny">${escapeHtml(
      String(e)
    )}</span><br/><br/>Make sure your backend is reachable from the phone and your Upload endpoint uses a LAN IP (not <code>localhost</code>).</td></tr>`;

    showWarn(
      els.warn,
      `Failed to load walks.<br/>Make sure the backend is reachable from your phone and your Upload endpoint is your computer's LAN IP (not <code>localhost</code>).`
    );
  }
});

