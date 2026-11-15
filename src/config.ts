// Where the LifeOS server runs on the phone (Termux), and how this app starts it.
export const BASE = 'http://127.0.0.1:4100';
export const START_URL = BASE + '/Phone.dc.html?view=phone';

const TERMUX_HOME = '/data/data/com.termux/files/home';
export const TERMUX = {
  bash: '/data/data/com.termux/files/usr/bin/bash',
  home: TERMUX_HOME,
  script: TERMUX_HOME + '/LifeOS-Desktop/phone/start-lifeos.sh',
};
// The same command, to paste into Termux by hand if the automatic start does not work.
export const START_COMMAND = 'bash ~/LifeOS-Desktop/phone/start-lifeos.sh';

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
