// Samsung Health -> LifeOS. Samsung Health shares its data with Android's Health Connect (turn that on in Samsung Health settings);
// this reads steps, sleep and resting heart rate from Health Connect for the last 7 days and sends the daily totals to the LifeOS server.
import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  SleepStageType,
} from 'react-native-health-connect';
import { postHealth } from './api';

const RECORDS = ['Steps', 'SleepSession', 'RestingHeartRate'] as const;
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d: Date, h: number, offsetDays = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, h, 0, 0, 0);
const range = (a: Date, b: Date) => ({ operator: 'between' as const, startTime: a.toISOString(), endTime: b.toISOString() });

async function ensurePermissions(): Promise<string | null> {
  const need = () => getGrantedPermissions().then((g: any[]) => RECORDS.filter((r) => !g.some((p) => p.recordType === r && p.accessType === 'read')));
  let missing = await need();
  if (missing.length) {
    await requestPermission(RECORDS.map((recordType) => ({ accessType: 'read' as const, recordType })));
    missing = await need();
  }
  return missing.length ? 'LifeOS needs permission to read: ' + missing.join(', ') + '. Allow it in Health Connect.' : null;
}

// Minutes actually asleep in a window (awake time inside a session is not counted when the session has stages).
function asleepMinutes(sessions: any[], from: Date, to: Date): number {
  let ms = 0;
  const clip = (s: string, e: string) => Math.max(0, Math.min(new Date(e).getTime(), to.getTime()) - Math.max(new Date(s).getTime(), from.getTime()));
  for (const s of sessions) {
    if (Array.isArray(s.stages) && s.stages.length) {
      for (const st of s.stages) {
        if ([SleepStageType.SLEEPING, SleepStageType.LIGHT, SleepStageType.DEEP, SleepStageType.REM].includes(st.stage)) ms += clip(st.startTime, st.endTime);
      }
    } else ms += clip(s.startTime, s.endTime);
  }
  return Math.round(ms / 60000);
}

/** Reads the last 7 days from Health Connect and posts them. Returns a short plain-words result. */
export async function syncHealth(): Promise<string> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    return status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
      ? 'Health Connect needs an update (Settings > Apps > Health Connect, or Google Play).'
      : 'Health Connect is not available on this phone.';
  }
  if (!(await initialize())) return 'Health Connect could not start.';
  const denied = await ensurePermissions();
  if (denied) return denied;

  const now = new Date();
  const sent: string[] = [];
  let failed = '';
  for (let i = 0; i < 7; i++) {
    const day = at(now, 0, -i), next = at(now, 0, -i + 1), end = i === 0 ? now : next;
    const body: { date: string; steps?: number; sleepMin?: number; restingHr?: number } = { date: dayKey(day) };
    try {
      const steps: any = await aggregateRecord({ recordType: 'Steps', timeRangeFilter: range(day, end) });
      if (steps && steps.COUNT_TOTAL > 0) body.steps = Math.round(steps.COUNT_TOTAL);
    } catch { /* no steps for that day */ }
    try {
      // the night that ends on this day: from 18:00 the evening before to 14:00 on the day
      const w0 = at(now, 18, -i - 1), w1 = at(now, 14, -i);
      if (w0 < now) {
        const res: any = await readRecords('SleepSession', { timeRangeFilter: range(w0, w1 < now ? w1 : now) });
        const m = asleepMinutes(res.records || [], w0, w1);
        if (m > 0) body.sleepMin = Math.min(m, 1440);
      }
    } catch { /* no sleep data */ }
    try {
      const res: any = await readRecords('RestingHeartRate', { timeRangeFilter: range(day, end) });
      const recs: any[] = res.records || [];
      if (recs.length) body.restingHr = Math.round(recs[recs.length - 1].beatsPerMinute);
    } catch { /* no resting heart rate */ }
    if (body.steps === undefined && body.sleepMin === undefined && body.restingHr === undefined) continue;
    try { await postHealth(body); sent.push(body.date.slice(5)); } catch (e: any) { failed = e && e.message ? e.message : String(e); }
  }
  if (failed && !sent.length) return 'Could not save to LifeOS: ' + failed;
  if (!sent.length) return 'No health data found for the last 7 days. In Samsung Health, open Settings > Health Connect and turn sync on.';
  return 'Health data updated for ' + sent.length + ' day' + (sent.length === 1 ? '' : 's') + (failed ? ' (some failed: ' + failed + ')' : '') + '.';
}
