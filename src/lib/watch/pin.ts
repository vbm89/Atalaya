import { createHash, timingSafeEqual } from "node:crypto";

const MIN = 4;
const MAX = 12;

export function normalizePin(raw: string): string | null {
  const pin = raw.trim();
  if (pin.length < MIN || pin.length > MAX) return null;
  if (!/^[0-9]+$/.test(pin)) return null;
  return pin;
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(pin, "utf8").digest("hex");
}

export function pinEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function envAlertPin(): string | null {
  const raw = typeof process === "undefined" ? undefined : process.env.ALERT_PIN;
  return raw ? normalizePin(raw) : null;
}

export function pinMatches(presented: string, storedHash: string | null): boolean {
  const pin = normalizePin(presented);
  if (!pin) return false;
  const env = envAlertPin();
  if (env) return pinEqual(pin, env);
  if (!storedHash) return false;
  return pinEqual(hashPin(pin), storedHash);
}
