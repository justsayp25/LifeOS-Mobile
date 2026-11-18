import { requireNativeModule } from 'expo';

// The phone's own speech recognition (see ReneeSpeechModule.kt). If this build has no native part, everything here says "not available" and the page keeps using Whisper.
export type SpeechEvent = { type: 'ready' | 'speech' | 'end' | 'partial' | 'final' | 'error'; text: string; code: number };

let mod: any = null;
try { mod = requireNativeModule('ReneeSpeech'); } catch { mod = null; }
let sub: { remove(): void } | null = null;

export function speechAvailable(): boolean {
  try { return !!mod && !!mod.isAvailable(); } catch { return false; }
}
export function speechStart(lang: string, silenceMs: number, offline: boolean, onEvent: (e: SpeechEvent) => void): void {
  if (!mod) throw new Error('Android listening is not in this build.');
  if (sub) { try { sub.remove(); } catch { /* gone */ } sub = null; }
  sub = mod.addListener('onSpeech', onEvent);
  mod.start(lang, silenceMs, offline);
}
export function speechStop(): void {
  try { if (mod) mod.stop(); } catch { /* nothing running */ }
}
export function speechCancel(): void {
  try { if (mod) mod.cancel(); } catch { /* nothing running */ }
  if (sub) { try { sub.remove(); } catch { /* gone */ } sub = null; }
}
