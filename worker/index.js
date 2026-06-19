function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") return json({ ok: true });
    return env.ASSETS.fetch(request); // static site
  },
};

export { json };
