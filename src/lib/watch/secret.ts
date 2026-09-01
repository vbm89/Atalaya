import { timingSafeEqual } from "node:crypto";

const MIN_LEN = 16;

export function watchSecret(): string | null {
  const raw = typeof process === "undefined" ? undefined : process.env.WATCH_SECRET;
  const value = raw?.trim() ?? "";
  if (value.length < MIN_LEN) return null;
  return value;
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function authorizeWatchRequest(request: Request): {
  ok: true;
} | { ok: false; status: number; error: string } {
  const secret = watchSecret();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "WATCH_SECRET no configurado.",
    };
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !equal(token, secret)) {
    return { ok: false, status: 401, error: "No autorizado." };
  }
  return { ok: true };
}
