// Pure progress-merge logic, shared by the app and unit tests.
export function pickCard(x, y) {
  if (!x) return y;
  if (!y) return x;
  const xk = x.state === "known", yk = y.state === "known";
  if (xk !== yk) return xk ? x : y;
  const xr = x.reps || 0, yr = y.reps || 0;
  if (xr !== yr) return xr > yr ? x : y;
  return (x.due || 0) >= (y.due || 0) ? x : y;
}

export function mergeProgress(local, server) {
  if (!server) return local;
  if (!local) return server;
  const out = {
    vocab: {},
    letters: {},
    counter: Math.max(local.counter || 0, server.counter || 0),
  };
  for (const key of ["vocab", "letters"]) {
    const a = local[key] || {}, b = server[key] || {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out[key][id] = pickCard(a[id], b[id]);
    }
  }
  return out;
}
