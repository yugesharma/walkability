export function inferBaseUrl(uploadUrl) {
  try {
    const u = new URL(uploadUrl, window.location.href);
    return u.origin;
  } catch {
    return "";
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function uploadFrame({ uploadUrl, blob, lat, lng, accuracy } = {}) {
  const fd = new FormData();
  fd.append("file", blob, "frame.jpg");
  if (typeof lat === "number" && Number.isFinite(lat)) fd.append("lat", String(lat));
  if (typeof lng === "number" && Number.isFinite(lng)) fd.append("lng", String(lng));
  if (typeof accuracy === "number" && Number.isFinite(accuracy)) fd.append("accuracy", String(accuracy));

  const res = await fetchWithTimeout(uploadUrl, { method: "POST", body: fd });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { res, text, data };
}

function maybeAddNumber(fd, key, value) {
  if (typeof value === "number" && Number.isFinite(value)) fd.append(key, String(value));
}

export async function startWalk({ startWalkUrl, lat, lng, accuracy } = {}) {
  const fd = new FormData();
  maybeAddNumber(fd, "lat", lat);
  maybeAddNumber(fd, "lng", lng);
  maybeAddNumber(fd, "accuracy", accuracy);

  const res = await fetchWithTimeout(startWalkUrl, { method: "POST", body: fd });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { res, text, data };
}

export async function stopWalk({ stopWalkUrl } = {}) {
  const res = await fetchWithTimeout(stopWalkUrl, { method: "POST" });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { res, text, data };
}

export async function listWalks({ walksUrl } = {}) {
  const res = await fetchWithTimeout(walksUrl, { method: "GET" });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { res, text, data };
}

