export function getEls() {
  return {
    video: document.getElementById("video"),
    canvas: document.getElementById("canvas"),
    output: document.getElementById("output"),
    endpointEl: document.getElementById("endpoint"),
    intervalEl: document.getElementById("interval"),
    deviceEl: document.getElementById("device"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    resultImg: document.getElementById("resultImg"),
    warn: document.getElementById("warn"),
    locateBtn: document.getElementById("locateBtn"),
    locText: document.getElementById("locText"),
    clickText: document.getElementById("clickText"),
  };
}

export function setStatus({ statusDot, statusText }, kind, text) {
  statusText.textContent = text;
  statusDot.classList.remove("ok", "bad");
  if (kind === "ok") statusDot.classList.add("ok");
  if (kind === "bad") statusDot.classList.add("bad");
}

export function showWarn(warnEl, msgHtml) {
  warnEl.style.display = "block";
  warnEl.innerHTML = msgHtml;
}

export function clearWarn(warnEl) {
  warnEl.style.display = "none";
  warnEl.textContent = "";
}

export function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

