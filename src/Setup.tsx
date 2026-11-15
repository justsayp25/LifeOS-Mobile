import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import TermuxRun from '../modules/termux-run';
import { ping } from './api';
import { C, CMD_CLAUDE, CMD_PROPS, CMD_SCRIPT, TERMUX, TEST_FILE_CMD } from './config';

type St = boolean | null; // null = cannot be checked from the app

export default function Setup({ onClose }: { onClose: () => void }) {
  const [installed, setInstalled] = useState<St>(null);
  const [perm, setPerm] = useState<St>(null);
  const [battery, setBattery] = useState<St>(null);
  const [server, setServer] = useState<St>(null);
  const [msg, setMsg] = useState('');

  const check = useCallback(async () => {
    setInstalled(await TermuxRun.isInstalled().catch(() => false));
    setPerm(await TermuxRun.hasPermission().catch(() => false));
    setBattery(await TermuxRun.batteryUnrestricted('com.termux').catch(() => null));
    setServer(await ping());
  }, []);
  useEffect(() => { check(); }, [check]);

  const copy = (t: string, what: string) => Clipboard.setStringAsync(t).then(() => setMsg(what + ' copied. Open Termux, paste, press Enter.'));
  const grant = async () => {
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request('com.termux.permission.RUN_COMMAND' as any).catch(() => 'denied');
      if (r !== 'granted') { setMsg('Android wants you to allow it by hand: Permissions > "Run commands in Termux environment" > Allow.'); Linking.openSettings().catch(() => {}); }
    }
    check();
  };
  const testRun = async () => {
    setMsg('');
    try {
      await TermuxRun.run(TERMUX.bash, ['-c', 'touch ~/ok'], TERMUX.home, true);
      setMsg('Sent. Now open Termux and type:  ' + TEST_FILE_CMD + '  . If it lists a file called ok, the app can run commands in Termux.');
    } catch (e: any) { setMsg('Failed: ' + (e && e.message ? e.message : String(e))); }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.body}>
      <Text style={s.title}>Set up automatic start</Text>
      <Text style={s.p}>Do these once. Each line turns green when it is done.</Text>

      <Row ok={installed} title="1. Termux is installed (F-Droid version)" fix={installed === false ? 'Install Termux from F-Droid, not Google Play.' : ''} />

      <Row ok={null} title="2. Termux allows other apps" fix="Paste this in Termux:">
        <Btn t="Copy command" onPress={() => copy(CMD_PROPS, 'Command')} />
      </Row>

      <Row ok={perm} title="3. LifeOS may run commands in Termux" fix={perm ? '' : 'Allow "Run commands in Termux environment" for LifeOS.'}>
        {!perm && <Btn t="Allow" onPress={grant} />}
      </Row>

      <Row ok={battery} title="4. Termux battery: Unrestricted" fix={battery ? '' : 'Android settings > Apps > Termux > Battery > Unrestricted.'}>
        {battery !== true && <Btn t="Open battery settings" onPress={() => Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings())} />}
      </Row>

      <Row ok={null} title="5. Start script in Termux" fix="Paste this in Termux once (it creates ~/lifeos-start.sh):">
        <Btn t="Copy command" onPress={() => copy(CMD_SCRIPT, 'Script command')} />
      </Row>

      <Row ok={null} title="6. Claude Code is signed in (inside Ubuntu)" fix="Paste this in Termux. It should print a short reply, not a login prompt:">
        <Btn t="Copy command" onPress={() => copy(CMD_CLAUDE, 'Command')} />
      </Row>

      <Row ok={null} title="Test: can this app run a command in Termux?" fix="Asks Termux to create a file ~/ok.">
        <Btn t="Run test" onPress={testRun} />
      </Row>

      <Row ok={server} title="LifeOS server answers" fix={server ? '' : 'Not running yet. Go back and press Start.'} />

      {!!msg && <Text style={s.msg}>{msg}</Text>}
      <View style={s.bar}>
        <Btn t="Check again" onPress={check} />
        <Btn t="Open Termux" onPress={() => TermuxRun.open().catch(() => {})} />
        <Btn t="Back" onPress={onClose} strong />
      </View>
    </ScrollView>
  );
}

function Row({ ok, title, fix, children }: { ok: St; title: string; fix?: string; children?: any }) {
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={[s.dot, ok === true && { backgroundColor: '#5FBF7F' }, ok === false && { backgroundColor: '#D9645A' }]} />
        <Text style={s.t}>{title}</Text>
      </View>
      {!!fix && <Text style={s.fix}>{fix}</Text>}
      {children ? <View style={s.row}>{children}</View> : null}
    </View>
  );
}
function Btn({ t, onPress, strong }: { t: string; onPress: () => void; strong?: boolean }) {
  return <Pressable onPress={onPress} style={[s.chip, strong && s.strong]}><Text style={[s.chipText, strong && { color: C.bg, fontWeight: '700' }]}>{t}</Text></Pressable>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { padding: 16, gap: 12 },
  title: { color: C.text, fontSize: 26, fontWeight: '700' },
  p: { color: C.soft, fontSize: 14.5 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.muted },
  t: { color: C.text, fontSize: 15, flex: 1 },
  fix: { color: C.muted, fontSize: 13 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.chip, borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  strong: { backgroundColor: C.text },
  chipText: { color: C.soft, fontSize: 13.5 },
  msg: { color: C.soft, fontSize: 13.5, padding: 4 },
  bar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4, paddingBottom: 24 },
});
