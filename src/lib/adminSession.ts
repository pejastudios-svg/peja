// src/lib/adminSession.ts
import crypto from "crypto";

// ─── PIN Hashing (scrypt — built into Node) ───────────────────
export function verifyPin(inputPin: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;

    const derived = crypto.scryptSync(inputPin, salt, 64).toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(derived, "hex"),
      Buffer.from(hash, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Session Tokens (HMAC-SHA256 signed) ──────────────────────
export const ADMIN_COOKIE_NAME = "peja-admin-session";
export const SESSION_MAX_AGE = 4 * 60 * 60; // 4 hours in seconds

function getSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET not set");
  return s;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionToken(): string {
  const id = crypto.randomBytes(32).toString("hex");
  const expires = (Date.now() + SESSION_MAX_AGE * 1000).toString();
  const payload = `${id}.${expires}`;
  return `${payload}.${hmac(payload)}`;
}

export function verifySessionToken(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [id, exp, sig] = parts;
    const payload = `${id}.${exp}`;
    const expected = hmac(payload);

    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

    return Date.now() <= parseInt(exp);
  } catch {
    return false;
  }
}