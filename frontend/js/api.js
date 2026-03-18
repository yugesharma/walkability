export function inferBaseUrl(uploadUrl) {
  try {
    const u = new URL(uploadUrl, window.location.href);
    return u.origin;
  } catch {
    return "";
  }
}

export async function uploadFrame({ uploadUrl, blob }) {
  const fd = new FormData();
  fd.append("file", blob, "frame.jpg");

  const res = await fetch(uploadUrl, { method: "POST", body: fd });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { res, text, data };
}

