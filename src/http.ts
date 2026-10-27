/** GET (or `init`) a JSON endpoint with a timeout; throws on a non-2xx answer. */
export async function getJson<T = unknown>(url: string, opts: { init?: RequestInit; timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, {
    ...opts.init,
    headers: { Accept: 'application/json', ...opts.init?.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
  return (await res.json()) as T;
}
