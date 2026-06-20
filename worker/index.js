import { handleGoogleAuth, readSession, clearCookie } from "./auth.js";
import { json, readJsonBody } from "./http.js";
import { handleFeedback } from "./feedback.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      if (p.startsWith("/api/")) {
        const limiter = p === "/api/feedback" ? env.FEEDBACK_RL : env.DEFAULT_RL;
        if (limiter) {
          const { success } = await limiter.limit({ key: ip });
          if (!success) return json({ error: "rate limited" }, 429);
        } else {
          console.error("rate-limit binding missing for", p);
        }
      }
      if (p === "/api/health") return json({ ok: true });
      if (p === "/api/auth/google" && request.method === "POST")
        return await handleGoogleAuth(await readJsonBody(request), env);
      if (p === "/api/feedback" && request.method === "POST")
        return await handleFeedback(await readJsonBody(request, 8 * 1024), env, request);
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
