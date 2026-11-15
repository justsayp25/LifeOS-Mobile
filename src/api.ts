import { BASE } from './config';

async function call(method: 'GET' | 'POST', path: string, body?: unknown, ms = 8000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    let j: any = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) throw new Error((j && j.error) || 'The server said ' + r.status + '.');
    return j;
  } finally { clearTimeout(t); }
}

/** True when the LifeOS server on the phone answers. */
export async function ping(): Promise<boolean> {
  try { const j = await call('GET', '/api/health', undefined, 2500); return !!(j && j.ok); } catch { return false; }
}

export type SyncResult = { ok: boolean; pulled: number; pushed: number; saved: number; conflicts: string[]; error?: string };

/** Vault sync through the private GitHub repo (the server does the work). Nothing is overwritten or deleted. */
export async function syncVault(): Promise<string> {
  let r: SyncResult;
  try { r = await call('POST', '/api/gitsync/run', {}, 180000); } catch (e: any) { return 'Sync did not run: ' + (e && e.message ? e.message : e); }
  if (!r.ok) return r.error || 'Sync did not finish.';
  const bits: string[] = [];
  bits.push(r.pulled ? 'Received ' + r.pulled + ' change' + (r.pulled === 1 ? '' : 's') : 'Nothing new to receive');
  bits.push(r.pushed ? 'sent ' + r.pushed : 'nothing to send');
  let s = bits.join(', ') + '.';
  if (r.conflicts && r.conflicts.length) s += '\nBoth versions were kept for ' + r.conflicts.length + ' note' + (r.conflicts.length === 1 ? '' : 's') + ':\n' + r.conflicts.map((c) => '• ' + c).join('\n');
  return s;
}

export async function postHealth(day: { date: string; steps?: number; sleepMin?: number; restingHr?: number; activeMin?: number; burnedCal?: number }): Promise<void> {
  await call('POST', '/api/health/phone', day);
}

/** Auto-sync (the server saves 30 s after your last change and checks GitHub every minute). */
export async function getAutosync(): Promise<boolean | null> {
  try { const j = await call('GET', '/api/autosync', undefined, 4000); return j && j.available !== false ? !!j.on : null; } catch { return null; }
}
export async function setAutosync(on: boolean): Promise<boolean | null> {
  try { const j = await call('POST', '/api/autosync', { on }, 4000); return j ? !!j.on : null; } catch { return null; }
}
