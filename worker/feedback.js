// Feedback endpoint logic: validation, GitHub/Turnstile calls, orchestration.

const MOODS = ["good", "ok", "bad"];
const MOOD_LABEL = { good: "🙂 good", ok: "😐 ok", bad: "🙁 bad" };

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

export function buildIssue(row) {
  const title = "Feedback: " + row.text.replace(/\s+/g, " ").slice(0, 60);
  const body = [
    row.text,
    "",
    "---",
    `**Mood:** ${row.mood ? MOOD_LABEL[row.mood] : "—"}`,
    `**Contact:** ${row.contact || "—"}`,
    `**Mode:** ${row.context?.mode || "—"}`,
    `**Version:** ${row.context?.version || "—"}`,
    `**User:** ${row.user_id ?? "anon"}`,
    `**UA:** ${row.context?.ua || "—"}`,
    `**At:** ${row.created_at}`,
  ].join("\n");
  return { title, body, labels: ["user-feedback"] };
}
