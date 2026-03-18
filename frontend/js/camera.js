export async function listCameras(deviceEl) {
  deviceEl.innerHTML = "";
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");

  for (let i = 0; i < cams.length; i++) {
    const d = cams[i];
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    deviceEl.appendChild(opt);
  }
}

export async function startCamera({ videoEl, deviceId, existingStream }) {
  if (existingStream) {
    existingStream.getTracks().forEach((t) => t.stop());
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
    audio: false,
  });

  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function captureBlob({ videoEl, canvasEl, quality = 0.85 }) {
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  canvasEl.width = w;
  canvasEl.height = h;

  const ctx = canvasEl.getContext("2d", { willReadFrequently: false });
  ctx.drawImage(videoEl, 0, 0, w, h);

  return new Promise((resolve) => canvasEl.toBlob(resolve, "image/jpeg", quality));
}

