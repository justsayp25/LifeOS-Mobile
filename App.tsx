import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView as RNWebView, type WebViewNavigation } from 'react-native-webview';
import TermuxRun from './modules/termux-run';
import { ping, syncVault } from './src/api';
import { BASE, C, START_COMMAND, START_URL, TERMUX } from './src/config';
import { syncHealth } from './src/health';

// react-native-webview 14 types do not accept `ref` on the function component under React 19; the component itself supports it.
const WebView: any = RNWebView;
type Phase = 'checking' | 'down' | 'up';

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

  // ---- is the server running? ----
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const ok = await ping();
      if (live) setPhase((p) => (ok ? (p === 'up' ? p : 'up') : p === 'up' ? p : 'down'));
    };
    tick();
    const t = setInterval(() => { if (phase !== 'up') tick(); }, 2000);
    return () => { live = false; clearInterval(t); };
  }, [phase]);

  // ---- microphone and camera for the pages (voice, photos) ----
  useEffect(() => {
    if (phase !== 'up' || Platform.OS !== 'android') return;
    PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]).catch(() => {});
  }, [phase]);

  // ---- Android back: close the menu, then go back a page, then leave ----
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) { setMenu(false); return true; }
      if (phase === 'up' && canGoBack.current && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [menu, phase]);

  // ---- start screen ----
  const [starting, setStarting] = useState(false);
  const start = useCallback(async () => {
    setNote(''); setStarting(true);
    try {
      if (!(await TermuxRun.isInstalled())) { setNote('Termux is not installed on this phone.'); setStarting(false); return; }
      await TermuxRun.run(TERMUX.bash, [TERMUX.script], TERMUX.home, true);
      setNote('Starting LifeOS…');
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (await ping()) { setPhase('up'); setStarting(false); return; }
      }
      setNote('LifeOS did not start in time. Open Termux and run the command below to see why.');
    } catch (e: any) {
      setNote((e && e.message ? e.message : 'Could not start it.') + ' Use the command below in Termux instead.');
    }
    setStarting(false);
  }, []);

  // ---- menu actions ----
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setNote('');
    try { setNote(await fn()); } catch (e: any) { setNote(e && e.message ? e.message : String(e)); }
    setBusy('');
  };

  const onNav = (n: WebViewNavigation) => { canGoBack.current = n.canGoBack; };
  const allow = (req: { url: string }) => {
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
            originWhitelist={['http://127.0.0.1:4100']}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            setSupportMultipleWindows={false}
            overScrollMode="never"
            textZoom={100}
            onNavigationStateChange={onNav}
            onShouldStartLoadWithRequest={allow}
            onError={() => setPhase('down')}
                        injectedJavaScriptBeforeContentLoaded="window.__LIFEOS_APP = 'android'; true;"
          />
          <Pressable accessibilityLabel="Menu" onPress={() => { setNote(''); setMenu(true); }} style={[s.dots, { top: 6 }]} hitSlop={10}>
            <Text style={s.dotsText}>⋮</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.center}>
          <Text style={s.title}>LifeOS</Text>
          {phase === 'checking' ? (
            <ActivityIndicator color={C.muted} />
          ) : (
            <>
              <Text style={s.p}>The LifeOS server on this phone is not running.</Text>
              <Pressable onPress={start} disabled={starting} style={[s.btn, starting && s.btnOff]}>
                <Text style={s.btnText}>{starting ? 'Starting…' : 'Start LifeOS'}</Text>
              </Pressable>
              {!!note && <Text style={s.note}>{note}</Text>}
              <View style={s.card}>
                <Text style={s.small}>Or paste this in Termux:</Text>
                <Text selectable style={s.code}>{START_COMMAND}</Text>
                <View style={s.row}>
                  <Pressable onPress={() => Clipboard.setStringAsync(START_COMMAND).then(() => setNote('Command copied.'))} style={s.chip}><Text style={s.chipText}>Copy</Text></Pressable>
                  <Pressable onPress={() => TermuxRun.open().catch(() => {})} style={s.chip}><Text style={s.chipText}>Open Termux</Text></Pressable>
                </View>
              </View>
              <Text style={s.hint}>First time? Run phone/setup-termux.sh from the LifeOS-Desktop folder in Termux (see phone/SETUP.md).</Text>
            </>
          )}
        </View>
      )}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={s.scrim} onPress={() => setMenu(false)}>
          <Pressable style={[s.sheet, { marginTop: insets.top + 44 }]} onPress={() => {}}>
            <MenuItem label="Sync vault" busy={busy === 'sync'} onPress={() => run('sync', syncVault)} />
            <MenuItem label="Update health data" busy={busy === 'health'} onPress={() => run('health', syncHealth)} />
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
