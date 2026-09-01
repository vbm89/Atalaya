const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function fetchText(
  url: string,
  opts?: { timeoutMs?: number; accept?: string; retries?: number },
): Promise<{ ok: boolean; status: number; text: string }> {
  const timeoutMs = opts?.timeoutMs ?? 12000;
  const retries = opts?.retries ?? 2;
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": UA,
          Accept: opts?.accept ?? "*/*",
        },
      });
      lastStatus = res.status;
      lastText = await res.text();
      if (res.status === 429 && attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      return { ok: res.ok, status: res.status, text: lastText };
    } catch (err) {
      lastText = err instanceof Error ? err.message : "network error";
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: lastStatus, text: lastText };
}

export async function fetchJson<T>(
  url: string,
  opts?: { timeoutMs?: number; retries?: number },
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const r = await fetchText(url, {
    ...opts,
    accept: "application/json,text/plain,*/*",
  });
  if (!r.ok) return { ok: false, status: r.status, data: null, error: r.text.slice(0, 240) };
  try {
    return { ok: true, status: r.status, data: JSON.parse(r.text) as T, error: null };
  } catch {
    return { ok: false, status: r.status, data: null, error: "JSON inválido" };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
