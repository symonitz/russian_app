// All D1 access lives here. Each function takes the Worker `env`.

export async function upsertUser(env, googleSub, email) {
  await env.DB.prepare(
    `INSERT INTO user (google_sub, email, created_at) VALUES (?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email`
  )
    .bind(googleSub, email ?? null, new Date().toISOString())
    .run();
  const row = await env.DB.prepare("SELECT id FROM user WHERE google_sub = ?")
    .bind(googleSub)
    .first();
  return { id: row.id };
}

export async function getProgress(env, userId) {
  const row = await env.DB.prepare("SELECT data FROM progress WHERE user_id = ?")
    .bind(userId)
    .first();
  return row ? JSON.parse(row.data) : null;
}

export async function putProgress(env, userId, data) {
  await env.DB.prepare(
    `INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  )
    .bind(userId, JSON.stringify(data), new Date().toISOString())
    .run();
}

export async function insertFeedback(env, row) {
  const res = await env.DB.prepare(
    `INSERT INTO feedback (text, mood, contact, context, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.text,
      row.mood ?? null,
      row.contact ?? null,
      JSON.stringify(row.context ?? {}),
      row.user_id ?? null,
      row.created_at
    )
    .run();
  return res.meta.last_row_id;
}

export async function setFeedbackIssue(env, id, issueNumber) {
  await env.DB.prepare("UPDATE feedback SET github_issue = ? WHERE id = ?")
    .bind(issueNumber, id)
    .run();
}
