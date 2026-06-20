const MAX_BODY_BYTES = 256 * 1024; // 256 KB — progress payloads are a few KB

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Read + size-cap a JSON request body. Throws a 413 if it's too large,
// before we ever buffer or store an oversized payload.
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw Object.assign(new Error("payload too large"), { status: 413 });
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw Object.assign(new Error("payload too large"), { status: 413 });
  }
  return JSON.parse(text);
}
