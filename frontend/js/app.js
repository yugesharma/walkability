import { getEls, setStatus, showWarn, clearWarn, escapeHtml } from "./ui.js";
import { listCameras, startCamera, captureBlob } from "./camera.js";
import { inferBaseUrl, uploadFrame } from "./api.js";
import { map_init } from "./map.js";
const els = getEls();

let stream = null;
let timer = null;
let inFlight = false;
let locateOnce = null;
let stopTracking = null;

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
    const { res, text, data } = await uploadFrame({ uploadUrl, blob });

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
    setStatus(els, "ok", "starting camera…");

    stream = await startCamera({
      videoEl: els.video,
      deviceId: els.deviceEl.value || undefined,
      existingStream: stream,
    });

    await listCameras(els.deviceEl);
    startLoop();
  } catch (e) {
    setStatus(els, "bad", "camera blocked");
    showWarn(
      els.warn,
      `Camera permission failed. Make sure this page is served over HTTP/HTTPS (not <code>file://</code>).<br/><br/>
       <b>Error:</b> <code>${escapeHtml(String(e))}</code>`
    );
  }
});

els.stopBtn.addEventListener("click", () => stopLoop());

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
        els.locText.textContent = r?.ok ? r.text : r?.reason || "location blocked";
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
            els.locText.textContent = r?.ok ? r.text : r?.reason || "location blocked";
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

