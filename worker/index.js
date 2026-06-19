import { handleGoogleAuth, readSession, clearCookie } from "./auth.js";

const MAX_BODY_BYTES = 256 * 1024; // 256 KB — progress payloads are a few KB

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Read + size-cap a JSON request body. Throws a 413 if it's too large,
// before we ever buffer or store an oversized payload.
async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/health") return json({ ok: true });
      if (p === "/api/auth/google" && request.method === "POST")
        return await handleGoogleAuth(await readJsonBody(request), env);
      if (p === "/api/auth/signout" && request.method === "POST")
        return json({ ok: true }, 200, { "set-cookie": clearCookie() });
      if (p === "/api/me") {
        const user = await readSession(request, env.SESSION_SECRET);
        return json({ signedIn: !!user });
      }
      if (p === "/api/progress") {
        const user = await readSession(request, env.SESSION_SECRET);
        if (!user) return json({ error: "unauthorized" }, 401);
        const { getProgress, putProgress } = await import("./db.js");
        if (request.method === "GET") return json({ progress: await getProgress(env, user.id) });
        if (request.method === "PUT") {
          await putProgress(env, user.id, await readJsonBody(request));
          return json({ ok: true });
        }
      }
    } catch (e) {
      // Log the real error for ourselves; return a generic message so we don't
      // leak internals (DB errors, stack details) to clients.
      console.error("request failed:", e);
      const status = e?.status || 400;
      return json({ error: status === 413 ? "payload too large" : "bad request" }, status);
    }
    return env.ASSETS.fetch(request);
  },
};

export { json, readJsonBody };
