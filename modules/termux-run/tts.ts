import { requireNativeModule } from 'expo';

// The phone's own text-to-speech (see ReneeTtsModule.kt). Without the native part everything here says "not available" and the page keeps its own voices.
export type TtsEvent = { type: 'ready' | 'unavailable' | 'start' | 'done' | 'error'; id: string };

let mod: any = null;
try { mod = requireNativeModule('ReneeTts'); } catch { mod = null; }
let sub: { remove(): void } | null = null;

export function ttsPresent(): boolean { return !!mod; }
export function ttsInit(onEvent: (e: TtsEvent) => void): void {
  if (!mod) { onEvent({ type: 'unavailable', id: '' }); return; }
  if (sub) { try { sub.remove(); } catch { /* gone */ } sub = null; }
  sub = mod.addListener('onTts', onEvent);
  mod.init();
}
export function ttsSpeak(id: string, text: string, rate: number): void { try { if (mod) mod.speak(id, text, rate); } catch { /* the page times out */ } }
export function ttsStop(): void { try { if (mod) mod.stop(); } catch { /* nothing playing */ } }
