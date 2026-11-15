// Where the LifeOS server runs on the phone (Termux), and how this app starts it.
export const BASE = 'http://127.0.0.1:4100';
export const START_URL = BASE + '/Phone.dc.html?view=phone';

const TERMUX_HOME = '/data/data/com.termux/files/home';
export const TERMUX = {
  bash: '/data/data/com.termux/files/usr/bin/bash',
  home: TERMUX_HOME,
  script: TERMUX_HOME + '/lifeos-start.sh',
};
// The same command, to paste into Termux by hand if the automatic start does not work.
export const START_COMMAND = 'bash ~/lifeos-start.sh';

// Colours from design/DESIGN.md (dark only).
export const C = {
  bg: '#121212',
  card: '#1A1A1A',
  chip: '#222222',
  line: '#333333',
  text: '#F5F5F5',
  soft: '#D0D0D0',
  muted: '#8A8A8A',
};

// Seconds to wait for the server after the start intent.
export const START_WAIT_S = 30;
// The server stops itself after this many idle minutes (the app sends /api/health every 30 s while it is open).
export const IDLE_MIN = 10;

// ---- one-time Termux setup, as copy buttons (Jess's phone: Termux from F-Droid, proot-distro Ubuntu, app in ~/lifeos, vault in ~/vault/LifeOS) ----
export const CMD_PROPS = [
  'mkdir -p ~/.termux',
  "grep -q '^allow-external-apps' ~/.termux/termux.properties 2>/dev/null || echo 'allow-external-apps = true' >> ~/.termux/termux.properties",
  'termux-reload-settings',
  'termux-wake-lock',
].join('\n');

const START_SCRIPT = `#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
if curl -fs http://127.0.0.1:4100/api/health >/dev/null; then exit 0; fi
nohup proot-distro login ubuntu -- bash -lc 'cd ~/lifeos && VAULT_PATH=$HOME/vault/LifeOS PORT=4100 IDLE_EXIT_MIN=${IDLE_MIN} node server.mjs' > ~/lifeos-server.log 2>&1 &
for i in $(seq 1 30); do curl -fs http://127.0.0.1:4100/api/health >/dev/null && exit 0; sleep 1; done
exit 1
`;
export const CMD_SCRIPT = "cat > ~/lifeos-start.sh <<'EOF'\n" + START_SCRIPT + "EOF\nchmod +x ~/lifeos-start.sh";
// Trivial test of the RUN_COMMAND intent: the app asks Termux to create ~/ok.
export const TEST_FILE_CMD = 'ls -l ~/ok';
// Claude Code check, run inside Ubuntu.
export const CMD_CLAUDE = "proot-distro login ubuntu -- bash -lc 'cd ~/vault/LifeOS && claude -p \"say ok\"'";
