import { SignJWT, jwtVerify } from "jose";

const enc = (secret) => new TextEncoder().encode(secret);
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
