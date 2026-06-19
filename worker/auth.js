import { SignJWT, jwtVerify } from "jose";

// Fail closed: a missing or weak SESSION_SECRET would otherwise sign sessions
// with a guessable key (an unset env var stringifies to "undefined").
const enc = (secret) => {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET missing or too short (need at least 32 chars)");
  }
  return new TextEncoder().encode(secret);
};
const MAX_AGE = 30 * 24 * 3600; // 30 days

export async function signSession(userId, secret) {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(enc(secret));
}

export async function readSession(request, secret) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], enc(secret));
    return { id: payload.uid };
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export function clearCookie() {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

import { createRemoteJWKSet } from "jose";
import { upsertUser } from "./db.js";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

// Verify a Google ID token (JWT) and return { sub, email }.
export async function verifyGoogleToken(idToken, clientId) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  return { sub: payload.sub, email: payload.email };
}

export async function handleGoogleAuth(body, env) {
  const { credential } = body;
  const { sub, email } = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
  const user = await upsertUser(env, sub, email);
  const token = await signSession(user.id, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true, email }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(token) },
  });
}
