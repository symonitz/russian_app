import { handleGoogleAuth, readSession, clearCookie } from "./auth.js";
import { json, readJsonBody } from "./http.js";

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

export { json, readJsonBody } from "./http.js";
