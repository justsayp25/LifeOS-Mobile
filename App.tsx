import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView as RNWebView, type WebViewNavigation } from 'react-native-webview';
import TermuxRun from './modules/termux-run';
import { getAutosync, ping, setAutosync, syncVault } from './src/api';
import { BASE, C, START_COMMAND, START_URL, START_WAIT_S, TERMUX } from './src/config';
import Setup from './src/Setup';
import { syncHealth } from './src/health';

// react-native-webview 14 types do not accept `ref` on the function component under React 19; the component itself supports it.
const WebView: any = RNWebView;

// Runs inside the page. Topmost thing first: an open panel or popup ("Close"), then the page's own back arrow ("Back ...").
const BACK_JS = `(function () {
  function vis(e) { var r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; }
  function find(sel) { var l = document.querySelectorAll(sel); for (var i = l.length - 1; i >= 0; i--) if (vis(l[i])) return l[i]; return null; }
  var el = find('[aria-label="Close"],[aria-label^="Close "]') || find('[aria-label^="Back"]');
  // tell the app BEFORE pressing: pressing can load another page, which would cut the message off
  window.ReactNativeWebView.postMessage(el ? 'back:handled' : 'back:none');
  if (el) el.click();
})(); true;`;
type Phase = 'checking' | 'starting' | 'down' | 'up' | 'setup';

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const web = useRef<any>(null);
  const canGoBack = useRef(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [auto, setAuto] = useState<boolean | null>(null);

  // ---- start the server by itself (Termux RUN_COMMAND), then show the dashboard ----
  const starting = useRef(false);
  const startAuto = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setNote(''); setPhase('starting');
    try {
      if (await ping()) { setPhase('up'); return; }
      if (!(await TermuxRun.isInstalled())) { setNote('Termux is not installed on this phone.'); setPhase('down'); return; }
      if (!(await TermuxRun.hasPermission())) {
        // ask Android for it right here (a system pop-up); no trip to Setup needed
        let granted = false;
        try { granted = (await PermissionsAndroid.request('com.termux.permission.RUN_COMMAND' as any)) === 'granted'; } catch { /* falls through */ }
        if (!granted || !(await TermuxRun.hasPermission())) {
          setNote('Android needs your OK once: in the page that just opened, tap Permissions, then "Run commands in Termux environment", then Allow. Come back and tap Retry.');
          Linking.openSettings().catch(() => {});
          setPhase('down'); return;
        }
      }
      await TermuxRun.run(TERMUX.bash, [TERMUX.script], TERMUX.home, true);
      for (let i = 0; i < START_WAIT_S; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await ping()) { setPhase('up'); return; }
      }
      setNote('LifeOS did not start in ' + START_WAIT_S + ' seconds. Open Setup to check each step, or look at ~/lifeos-server.log in Termux.');
      setPhase('down');
    } catch (e: any) {
      setNote((e && e.message ? e.message : 'Could not start it.') + ' Open Setup to check each step.');
      setPhase('down');
    } finally { starting.current = false; }
  }, []);

  // first open: try to start. Back in the app after it was away: check again (the server stops itself when idle).
  useEffect(() => { startAuto(); }, [startAuto]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (st) => {
      if (st !== 'active' || phase === 'setup' || phase === 'starting') return;
      if (!(await ping())) startAuto();
    });
    return () => sub.remove();
  }, [phase, startAuto]);
  // while the app is open, keep the server awake (it counts requests) and notice if it went away
  useEffect(() => {
    if (phase !== 'up') return;
    const t = setInterval(async () => { if (!(await ping()) && !(await ping())) startAuto(); }, 30000);
    return () => clearInterval(t);
  }, [phase, startAuto]);

  // ---- Samsung Health: update by itself when the app opens, when you come back to it, and every 5 minutes while it is open ----
  const [autoHealthInfo, setAutoHealthInfo] = useState('');
  const healthBusy = useRef(false);
  const healthAt = useRef(0);
  const autoHealth = useCallback(async () => {
    if (healthBusy.current || Date.now() - healthAt.current < 60000) return;
    healthBusy.current = true; healthAt.current = Date.now();
    const t = new Date(), hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    try { setAutoHealthInfo(hhmm + ' ' + ((await syncHealth(true)) || 'nothing to do')); } catch (e: any) { setAutoHealthInfo(hhmm + ' error: ' + String((e && e.message) || e).slice(0, 80)); } finally { healthBusy.current = false; }
  }, []);
  useEffect(() => {
    if (phase !== 'up') return;
    autoHealth();
    const t = setInterval(autoHealth, 5 * 60 * 1000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') autoHealth(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [phase, autoHealth]);

  // ---- microphone and camera for the pages (voice, photos) ----
  useEffect(() => {
    if (phase !== 'up' || Platform.OS !== 'android') return;
    PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]).catch(() => {});
  }, [phase]);

  // ---- Android back: close the menu, then go back a page, then leave ----
  // The back gesture does what the arrow on the page does: close an open panel first, else press the visible "Back" control,
  // else go back in history, else leave the app. The page runs this (BACK_JS) and answers 'back:handled' or 'back:none'.
  const backTimer = useRef<any>(null);
  const backFallback = useCallback(() => {
    if (canGoBack.current && web.current) web.current.goBack(); else BackHandler.exitApp();
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) { setMenu(false); return true; }
      if (phase === 'up' && web.current) {
        clearTimeout(backTimer.current);
        backTimer.current = setTimeout(backFallback, 700); // the page did not answer: plain history
        web.current.injectJavaScript(BACK_JS);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [menu, phase, backFallback]);
  const onWebMessage = (e: any) => {
    const d = e && e.nativeEvent ? e.nativeEvent.data : '';
    if (d !== 'back:handled' && d !== 'back:none') return;
    clearTimeout(backTimer.current);
    if (d === 'back:none') backFallback();
  };

  // ---- menu actions ----
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setNote('');
    try { setNote(await fn()); } catch (e: any) { setNote(e && e.message ? e.message : String(e)); }
    setBusy('');
  };

  const onNav = (n: WebViewNavigation) => { canGoBack.current = n.canGoBack; };
  const allow = (req: { url: string }) => {
    // Quick links (Gmail, Drive, Canvas) come as intent:// links: open the installed app, or the web page if it is not installed
    if (req.url.startsWith('intent:')) {
      const pkg = (req.url.match(/package=([\w.]+)/) || [])[1];
      let web = ''; try { web = decodeURIComponent((req.url.match(/S\.browser_fallback_url=([^;]+)/) || [])[1] || ''); } catch { /* none */ }
      (async () => {
        let opened = false;
        if (pkg) { try { opened = await TermuxRun.openApp(pkg); } catch { opened = false; } }
        if (!opened && web) Linking.openURL(web).catch(() => {});
      })();
      return false;
    }
    if (req.url.startsWith(BASE) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
    Linking.openURL(req.url).catch(() => {}); // anything outside LifeOS opens in the browser
    return false;
  };

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="light" />

      {phase === 'up' ? (
        <View style={s.fill}>
          <WebView
            ref={web}
            source={{ uri: START_URL }}
            style={s.web}
            originWhitelist={['http://127.0.0.1:4100', 'intent://*']}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            setSupportMultipleWindows={false}
            overScrollMode="never"
            textZoom={100}
            onNavigationStateChange={onNav}
            onMessage={onWebMessage}
            onShouldStartLoadWithRequest={allow}
            onError={() => startAuto()}
                        injectedJavaScriptBeforeContentLoaded="window.__LIFEOS_APP = 'android'; true;"
          />
          <Pressable accessibilityLabel="Menu" onPress={() => { setNote(''); setMenu(true); getAutosync().then(setAuto); }} style={[s.dots, { top: 6 }]} hitSlop={10}>
            <Text style={s.dotsText}>⋮</Text>
          </Pressable>
        </View>
      ) : phase === 'setup' ? (
        <Setup onClose={() => startAuto()} />
      ) : (
        <View style={s.center}>
          <View style={s.logo}><View style={s.logoDot} /></View>
          {phase === 'checking' || phase === 'starting' ? (
            <>
              <Text style={s.title}>Starting R.E.N.E.E.</Text>
              <ActivityIndicator color={C.muted} />
              <Text style={s.hint}>This takes a few seconds.</Text>
            </>
          ) : (
            <>
              <Text style={s.title}>R.E.N.E.E. did not start</Text>
              <Text style={s.p}>{note || 'The LifeOS server on this phone is not running.'}</Text>
              <Pressable onPress={startAuto} style={s.btn}><Text style={s.btnText}>Retry</Text></Pressable>
              <View style={s.row}>
                <Pressable onPress={() => TermuxRun.open().catch(() => {})} style={s.chip}><Text style={s.chipText}>Open Termux</Text></Pressable>
                <Pressable onPress={() => setPhase('setup')} style={s.chip}><Text style={s.chipText}>Setup</Text></Pressable>
              </View>
              <View style={s.card}>
                <Text style={s.small}>Or start it by hand in Termux:</Text>
                <Text selectable style={s.code}>{START_COMMAND}</Text>
                <Pressable onPress={() => Clipboard.setStringAsync(START_COMMAND).then(() => setNote('Command copied.'))} style={s.chip}><Text style={s.chipText}>Copy</Text></Pressable>
              </View>
            </>
          )}
        </View>
      )}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={s.scrim} onPress={() => setMenu(false)}>
          <Pressable style={[s.sheet, { marginTop: insets.top + 44 }]} onPress={() => {}}>
            <MenuItem label="Sync vault" busy={busy === 'sync'} onPress={() => run('sync', syncVault)} />
            {auto !== null && <MenuItem label={'Auto-sync: ' + (auto ? 'on' : 'off')} onPress={() => setAutosync(!auto).then((v) => v !== null && setAuto(v))} />}
            <MenuItem label="Update health data" busy={busy === 'health'} onPress={() => run('health', syncHealth)} />
            <MenuItem label="Setup" onPress={() => { setMenu(false); setPhase('setup'); }} />
            {!!autoHealthInfo && <Text style={s.result}>{'Last automatic health update: ' + autoHealthInfo}</Text>}
            <MenuItem label="Reload" onPress={() => { setMenu(false); web.current?.reload(); }} />
            {!!note && <Text style={s.result}>{note}</Text>}
            <MenuItem label="Close" onPress={() => setMenu(false)} muted />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function MenuItem({ label, onPress, busy, muted }: { label: string; onPress: () => void; busy?: boolean; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [s.item, pressed && { backgroundColor: C.chip }]}>
      <Text style={[s.itemText, muted && { color: C.muted }]}>{label}</Text>
      {busy ? <ActivityIndicator color={C.muted} size="small" /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: C.bg },
  dots: { position: 'absolute', right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(34,34,34,0.7)', alignItems: 'center', justifyContent: 'center' },
  dotsText: { color: C.soft, fontSize: 18, lineHeight: 20, fontWeight: '700' },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logoDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F5F5F5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 14 },
  title: { color: C.text, fontSize: 34, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  p: { color: C.soft, fontSize: 15, textAlign: 'center' },
  btn: { backgroundColor: C.text, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 34, marginTop: 4 },
  btnOff: { opacity: 0.55 },
  btnText: { color: C.bg, fontSize: 16, fontWeight: '700' },
  note: { color: C.soft, fontSize: 13.5, textAlign: 'center' },
  card: { alignSelf: 'stretch', backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8, marginTop: 10 },
  small: { color: C.muted, fontSize: 12.5 },
  code: { color: C.text, fontFamily: 'monospace', fontSize: 13, backgroundColor: C.chip, borderRadius: 12, padding: 10 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: C.chip, borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
  chipText: { color: C.soft, fontSize: 13.5 },
  hint: { color: C.muted, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'flex-end', paddingHorizontal: 12 },
  sheet: { width: 270, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, paddingVertical: 6, overflow: 'hidden' },
  item: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemText: { color: C.text, fontSize: 15 },
  result: { color: C.soft, fontSize: 13, paddingHorizontal: 16, paddingVertical: 10 },
});
