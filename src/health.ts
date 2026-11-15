// Samsung Health -> LifeOS (steps, sleep, resting heart rate, exercise minutes, calories burned). Samsung Health shares its data with Android's Health Connect (turn that on in Samsung Health settings);
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

const RECORDS = ['Steps', 'SleepSession', 'RestingHeartRate', 'ExerciseSession', 'TotalCaloriesBurned', 'ActiveCaloriesBurned'] as const;
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d: Date, h: number, offsetDays = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, h, 0, 0, 0);
const range = (a: Date, b: Date) => ({ operator: 'between' as const, startTime: a.toISOString(), endTime: b.toISOString() });

/** Which record types may be read right now. With `ask`, missing ones are requested (a Health Connect page opens); without it nothing is asked. */
async function grantedTypes(ask: boolean): Promise<{ ok: Set<string>; missing: string[] }> {
  const read = () => getGrantedPermissions().then((g: any[]) => new Set<string>(g.filter((p) => p.accessType === 'read').map((p) => p.recordType)));
  let ok = await read();
  let missing = RECORDS.filter((r) => !ok.has(r));
  if (missing.length && ask) {
    await requestPermission(RECORDS.map((recordType) => ({ accessType: 'read' as const, recordType })));
    ok = await read(); missing = RECORDS.filter((r) => !ok.has(r));
  }
  return { ok, missing };
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

const reason = (e: any) => String((e && e.message) || e || 'unknown').replace(/\s+/g, ' ').slice(0, 90);
// Minutes of exercise sessions inside a window.
function exerciseMinutes(sessions: any[], from: Date, to: Date): number {
  let ms = 0;
  for (const s of sessions) ms += Math.max(0, Math.min(new Date(s.endTime).getTime(), to.getTime()) - Math.max(new Date(s.startTime).getTime(), from.getTime()));
  return Math.round(ms / 60000);
}

/**
 * Reads the last 7 days from Health Connect and posts them to the LifeOS server on this phone. Returns a short plain-words result.
 * silent = run in the background (when the app opens): it never opens a permission page, and it uses only what was already allowed.
 */
export async function syncHealth(silent = false): Promise<string> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    if (silent) return '';
    return status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
      ? 'Health Connect needs an update (Settings > Apps > Health Connect, or Google Play).'
      : 'Health Connect is not available on this phone.';
  }
  if (!(await initialize())) return silent ? '' : 'Health Connect could not start.';
  const { ok: can, missing } = await grantedTypes(!silent);
  if (!can.size) return silent ? '' : 'LifeOS needs permission to read your health data. Allow it in Health Connect.';

  const now = new Date();
  const sent: string[] = [];
  const why: Record<string, string> = {}; // first reason a number could not be read, so nothing fails silently
  const had: Record<string, boolean> = {};
  let failed = '';
  for (let i = 0; i < 7; i++) {
    const day = at(now, 0, -i), next = at(now, 0, -i + 1), end = i === 0 ? now : next;
    const body: { date: string; steps?: number; sleepMin?: number; restingHr?: number; activeMin?: number; burnedCal?: number } = { date: dayKey(day) };
    if (can.has('Steps')) try {
      const steps: any = await aggregateRecord({ recordType: 'Steps', timeRangeFilter: range(day, end) });
      if (steps && steps.COUNT_TOTAL > 0) body.steps = Math.round(steps.COUNT_TOTAL);
    } catch (e) { why.steps = why.steps || reason(e); }
    if (can.has('SleepSession')) try {
      // the night that ends on this day: from 18:00 the evening before to 14:00 on the day
      const w0 = at(now, 18, -i - 1), w1 = at(now, 14, -i);
      if (w0 < now) {
        const res: any = await readRecords('SleepSession', { timeRangeFilter: range(w0, w1 < now ? w1 : now) });
        const m = asleepMinutes(res.records || [], w0, w1);
        if (m > 0) body.sleepMin = Math.min(m, 1440);
      }
    } catch (e) { why.sleep = why.sleep || reason(e); }
    if (can.has('RestingHeartRate')) try {
      const res: any = await readRecords('RestingHeartRate', { timeRangeFilter: range(day, end) });
      const recs: any[] = res.records || [];
      if (recs.length) body.restingHr = Math.round(recs[recs.length - 1].beatsPerMinute);
    } catch (e) { why['resting heart rate'] = why['resting heart rate'] || reason(e); }
    if (can.has('ExerciseSession')) try {
      const res: any = await readRecords('ExerciseSession', { timeRangeFilter: range(day, end) });
      const m = exerciseMinutes(res.records || [], day, end);
      if (m > 0) body.activeMin = Math.min(m, 1440);
    } catch (e) { why['exercise minutes'] = why['exercise minutes'] || reason(e); }
    // calories burned: the day's total if Samsung shares it, otherwise the active part
    for (const [type, key] of [['TotalCaloriesBurned', 'ENERGY_TOTAL'], ['ActiveCaloriesBurned', 'ACTIVE_CALORIES_TOTAL']] as const) {
      if (body.burnedCal !== undefined || !can.has(type)) continue;
      try {
        const a: any = await aggregateRecord({ recordType: type, timeRangeFilter: range(day, end) });
        const kcal = a && a[key] ? a[key].inKilocalories : 0;
        if (kcal > 0) body.burnedCal = Math.round(kcal);
      } catch (e) { why.calories = why.calories || reason(e); }
    }
    for (const k of ['steps', 'sleepMin', 'restingHr', 'activeMin', 'burnedCal'] as const) if (body[k] !== undefined) had[k] = true;
    if (!Object.keys(body).some((k) => k !== 'date')) continue;
    try { await postHealth(body); sent.push(body.date.slice(5)); } catch (e: any) { failed = e && e.message ? e.message : String(e); }
  }
  if (silent) return failed ? 'failed: ' + failed : sent.length ? 'ok' : '';
  if (failed && !sent.length) return 'Could not save to LifeOS: ' + failed;
  if (!sent.length) return 'No health data found for the last 7 days. In Samsung Health, open Settings > Health Connect and turn sync on.';
  const names: Record<string, string> = { steps: 'steps', sleepMin: 'sleep', restingHr: 'resting heart rate', activeMin: 'exercise minutes', burnedCal: 'calories' };
  const got = Object.keys(had).map((k) => names[k]);
  const none = Object.values(names).filter((n) => !got.includes(n));
  let out = 'Health data updated for ' + sent.length + ' day' + (sent.length === 1 ? '' : 's') + (failed ? ' (some failed: ' + failed + ')' : '') + '.\nGot: ' + got.join(', ') + '.';
  if (none.length) out += '\nNo data from Samsung for: ' + none.join(', ') + '.' + Object.entries(why).map(([k, v]) => '\n' + k + ': ' + v).join('');
  if (missing.length) out += '\nNot allowed yet: ' + missing.join(', ') + '.';
  return out;
}
