import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import TermuxRun from '../modules/termux-run';
import { C } from './config';
import { clearToken, countFiles, downloadVault, getLastSync, getToken, REPO_URL, setToken, sync, VAULT_DIR, vaultReady } from './vault/vault';

type Screen = 'boot' | 'access' | 'token' | 'download' | 'home';

export default function VaultApp() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>('boot');
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<number | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState('');

  const refreshHome = useCallback(async () => {
    setFiles(await countFiles().catch(() => null));
    setLast(await getLastSync());
  }, []);

  // decide which screen to show
  const route = useCallback(async () => {
    if (!(await TermuxRun.hasAllFilesAccess().catch(() => false))) { setScreen('access'); return; }
    const token = await getToken();
    if (await vaultReady().catch(() => false)) { setScreen('home'); refreshHome(); return; }
    setScreen(token ? 'download' : 'token');
  }, [refreshHome]);

  useEffect(() => { route(); }, [route]);
  // back from the Android settings page
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && screen === 'access') route(); });
    return () => sub.remove();
  }, [screen, route]);

  // download starts by itself once there is a token
  useEffect(() => {
    if (screen !== 'download') return;
    let live = true;
    (async () => {
      setMsg(''); setProgress('Starting…');
      const token = await getToken();
      try {
        await downloadVault(token || '', (m) => live && setProgress(m));
        if (live) { setScreen('home'); refreshHome(); }
      } catch (e: any) {
        if (live) { setMsg((e && e.message) || 'Download failed.'); setScreen('token'); }
      }
    })();
    return () => { live = false; };
  }, [screen, refreshHome]);

  const saveToken = async () => {
    if (input.trim().length < 20) { setMsg('That does not look like a token. It starts with github_pat_ and is long.'); return; }
    await setToken(input); setInput(''); setMsg(''); setScreen('download');
  };

  const doSync = async () => {
    setBusy(true); setSyncMsg('Syncing…');
    const token = await getToken();
    const r = await sync(token || '');
    setSyncMsg(r.message || (r.ok ? 'Done.' : 'Sync did not finish.'));
    setBusy(false); refreshHome();
  };

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={s.logo}><View style={s.logoDot} /></View>

          {screen === 'boot' && <ActivityIndicator color={C.muted} />}

          {screen === 'access' && (
            <>
              <Text style={s.title}>Allow file access</Text>
              <Text style={s.p}>Your vault is kept in a normal folder on the phone (LifeOS), so Claude Code in Termux can read the same notes. Android needs you to allow this once.</Text>
              <Btn t="Open the setting" onPress={() => TermuxRun.requestAllFilesAccess().catch(() => {})} />
              <Text style={s.hint}>Turn on "Allow access to manage all files" for LifeOS, then come back.</Text>
            </>
          )}

          {screen === 'token' && (
            <>
              <Text style={s.title}>Connect your vault</Text>
              <Text style={s.p}>Paste your GitHub token once. It stays on this phone and is used only to download and sync the vault.</Text>
              <TextInput value={input} onChangeText={setInput} placeholder="github_pat_…" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={s.input} />
              <Btn t="Connect" onPress={saveToken} />
              {!!msg && <Text style={s.err}>{msg}</Text>}
            </>
          )}

          {screen === 'download' && (
            <>
              <Text style={s.title}>Downloading your vault</Text>
              <ActivityIndicator color={C.muted} />
              <Text style={s.hint}>{progress}</Text>
              <Text style={s.hint}>This can take a few minutes the first time. Keep the app open.</Text>
            </>
          )}

          {screen === 'home' && (
            <>
              <Text style={s.title}>LifeOS</Text>
              <View style={s.card}>
                <Text style={s.ok}>● Vault connected</Text>
                <Row k="Folder" v={VAULT_DIR} />
                <Row k="Repo" v={REPO_URL.replace('https://github.com/', '').replace('.git', '')} />
                <Row k="Files" v={files === null ? '…' : String(files)} />
                <Row k="Last sync" v={last ? new Date(last).toLocaleString() : 'not yet'} />
              </View>
              <Btn t={busy ? 'Syncing…' : 'Sync'} onPress={doSync} disabled={busy} />
              {!!syncMsg && <Text style={s.p}>{syncMsg}</Text>}
              <View style={s.card}>
                <Text style={s.small}>Next update</Text>
                <Text style={s.p}>Your dashboard pages open here, reading this vault. The agent (Claude Code in Termux) comes after that.</Text>
              </View>
              <Pressable onPress={async () => { await clearToken(); setSyncMsg('Token removed from this phone. Your files stay.'); setScreen('token'); }}>
                <Text style={s.link}>Remove token (keeps your files)</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Btn({ t, onPress, disabled }: { t: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.btn, disabled && { opacity: 0.55 }]}><Text style={s.btnText}>{t}</Text></Pressable>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <View style={s.row}><Text style={s.k}>{k}</Text><Text style={s.v}>{v}</Text></View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logoDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F5F5F5' },
  title: { color: C.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  p: { color: C.soft, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  hint: { color: C.muted, fontSize: 13, textAlign: 'center' },
  err: { color: '#E08A82', fontSize: 14, textAlign: 'center' },
  input: { alignSelf: 'stretch', backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 14, color: C.text, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  btn: { backgroundColor: C.text, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 40 },
  btnText: { color: C.bg, fontSize: 16, fontWeight: '700' },
  card: { alignSelf: 'stretch', backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  ok: { color: '#5FBF7F', fontSize: 15, fontWeight: '600' },
  small: { color: C.muted, fontSize: 12.5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  k: { color: C.muted, fontSize: 14 },
  v: { color: C.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  link: { color: C.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 8 },
});
