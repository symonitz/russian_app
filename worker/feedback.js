// Feedback endpoint logic: validation, GitHub/Turnstile calls, orchestration.

const MOODS = ["good", "ok", "bad"];

export function validateFeedback(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid" };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (text.length < 1) return { ok: false, error: "empty" };
  if (text.length > 2000) return { ok: false, error: "too long" };

  const mood = MOODS.includes(payload.mood) ? payload.mood : null;

  let contact = typeof payload.contact === "string" ? payload.contact.trim().slice(0, 200) : "";
  if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) contact = "";

  const c = payload.context && typeof payload.context === "object" ? payload.context : {};
  const context = {
    mode: typeof c.mode === "string" ? c.mode.slice(0, 40) : "",
    version: typeof c.version === "string" ? c.version.slice(0, 40) : "",
    ua: typeof c.ua === "string" ? c.ua.slice(0, 300) : "",
  };

  return { ok: true, value: { text, mood, contact: contact || null, context } };
}
