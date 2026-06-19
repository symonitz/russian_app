import { handleGoogleAuth, readSession, clearCookie } from "./auth.js";

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/health") return json({ ok: true });
      if (p === "/api/auth/google" && request.method === "POST")
        return await handleGoogleAuth(request, env);
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
          const body = await request.json();
          await putProgress(env, user.id, body);
          return json({ ok: true });
        }
      }
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
    return env.ASSETS.fetch(request);
  },
};

export { json };
