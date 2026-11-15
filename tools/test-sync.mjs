// Tests src/vault/sync.ts on a THROWAWAY vault: a local git server (git http-backend) that demands a token, a "phone" and a "PC".
// Run: node --experimental-strip-types tools/test-sync.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { cloneVault, syncVault, isCloned } from '../src/vault/sync.ts';
import { http as rnHttp } from '../src/vault/http.ts';

const TOKEN = 'secret-test-token';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-sync-'));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'pc', GIT_AUTHOR_EMAIL: 'pc@x', GIT_COMMITTER_NAME: 'pc', GIT_COMMITTER_EMAIL: 'pc@x' } });
const bare = path.join(root, 'srv', 'vault.git');
fs.mkdirSync(bare, { recursive: true });
sh(bare, 'init', '-q', '--bare', '-b', 'master'); sh(bare, 'config', 'http.receivepack', 'true');
const seed = path.join(root, 'seed'); fs.mkdirSync(seed);
sh(seed, 'init', '-q', '-b', 'master');
fs.mkdirSync(path.join(seed, '1 Human')); fs.writeFileSync(path.join(seed, '1 Human', 'Note.md'), 'hello\n');
fs.writeFileSync(path.join(seed, 'Tasks.md'), '- [ ] one\n- [ ] two\n'); fs.writeFileSync(path.join(seed, 'AGENTS.md'), 'rules\n');
sh(seed, 'add', '-A'); sh(seed, 'commit', '-qm', 'seed'); sh(seed, 'push', '-q', bare, 'master');

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('x-access-token:' + TOKEN).toString('base64')) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const p = spawn('git', ['http-backend'], { env: { ...process.env, GIT_PROJECT_ROOT: path.join(root, 'srv'), GIT_HTTP_EXPORT_ALL: '1', REQUEST_METHOD: req.method, PATH_INFO: u.pathname, QUERY_STRING: u.search.slice(1), CONTENT_TYPE: req.headers['content-type'] || '', CONTENT_LENGTH: req.headers['content-length'] || '', REMOTE_USER: 'x', HTTP_CONTENT_ENCODING: req.headers['content-encoding'] || '', HTTP_GIT_PROTOCOL: req.headers['git-protocol'] || '' } });
  req.pipe(p.stdin);
  const chunks = []; p.stdout.on('data', (c) => chunks.push(c));
  p.on('close', () => {
    const out = Buffer.concat(chunks); const i = out.indexOf('\r\n\r\n');
    const head = out.slice(0, i).toString().split('\r\n'); let status = 200; const h = {};
    for (const l of head) { const k = l.indexOf(':'); const n = l.slice(0, k).toLowerCase(), v = l.slice(k + 1).trim(); if (n === 'status') status = parseInt(v); else h[n] = v; }
    res.writeHead(status, h); res.end(out.slice(i + 4));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/vault.git';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const phone = path.join(root, 'phone'), pc = path.join(root, 'pc');
const E = (token = TOKEN) => ({ fs, http: rnHttp, dir: phone, url, token, device: 'phone', branch: 'master' });

// wrong token must fail and download nothing
let bad = false; try { await cloneVault({ ...E('nope'), dir: path.join(root, 'bad') }); } catch { bad = true; }
ok(bad, 'wrong token is refused');

await cloneVault(E());
ok(await isCloned({ fs, dir: phone }), 'vault downloaded');
ok(fs.readFileSync(path.join(phone, '1 Human', 'Note.md'), 'utf8') === 'hello\n', 'files are there');
sh(root, 'clone', '-q', bare, pc);

let r = await syncVault(E());
ok(r.ok && !r.pushed === false && r.saved === 0, 'sync with no changes is ok: ' + r.message);
r = await syncVault(E()); ok(r.ok, 'running sync twice is safe');

// phone edits + a new note -> pushed
fs.writeFileSync(path.join(phone, '1 Human', 'Note.md'), 'hello from phone\n'); fs.writeFileSync(path.join(phone, 'New.md'), 'new\n');
r = await syncVault(E()); ok(r.ok && r.saved === 2, 'phone changes sent: ' + r.message);
sh(pc, 'pull', '-q'); ok(fs.readFileSync(path.join(pc, 'New.md'), 'utf8') === 'new\n' && fs.readFileSync(path.join(pc, '1 Human', 'Note.md'), 'utf8') === 'hello from phone\n', 'PC received them');

// PC changes -> phone receives
fs.writeFileSync(path.join(pc, 'AGENTS.md'), 'new rules\n'); sh(pc, 'commit', '-qam', 'pc edit'); sh(pc, 'push', '-q');
r = await syncVault(E()); ok(r.ok && r.pulled && fs.readFileSync(path.join(phone, 'AGENTS.md'), 'utf8') === 'new rules\n', 'PC changes received: ' + r.message);

// both change the same note
fs.writeFileSync(path.join(phone, 'Tasks.md'), '- [x] one\n- [ ] two\n- [ ] phone task\n');
fs.writeFileSync(path.join(pc, 'Tasks.md'), '- [ ] one\n- [x] two\n- [ ] pc task\n'); sh(pc, 'commit', '-qam', 'pc tasks'); sh(pc, 'push', '-q');
fs.writeFileSync(path.join(phone, 'Other.md'), 'phone only\n');
r = await syncVault(E());
ok(r.ok && r.conflicts.length === 1, 'conflict kept both: ' + r.message);
const files = fs.readdirSync(phone);
const copy = files.find((f) => f.startsWith('Tasks (conflict phone'));
ok(fs.readFileSync(path.join(phone, 'Tasks.md'), 'utf8').includes('pc task'), 'remote version under the original name');
ok(copy && fs.readFileSync(path.join(phone, copy), 'utf8').includes('phone task'), 'phone version saved as ' + copy);
ok(fs.existsSync(path.join(phone, 'Other.md')), 'unrelated phone note untouched');
sh(pc, 'pull', '-q'); ok(fs.existsSync(path.join(pc, copy)) && fs.existsSync(path.join(pc, 'Other.md')), 'PC got the conflict copy and the other note');
r = await syncVault(E()); ok(r.ok && r.saved === 0 && !r.conflicts.length, 'settled: nothing left to do');

// a note deleted on the phone goes to the vault's Bin (1 Human/99 Bin), with its text
const noteText = fs.readFileSync(path.join(phone, '1 Human', 'Note.md'), 'utf8');
fs.rmSync(path.join(phone, '1 Human', 'Note.md')); r = await syncVault(E());
const binned = path.join(phone, '1 Human', '99 Bin', 'Note.md');
ok(r.ok && !fs.existsSync(path.join(phone, '1 Human', 'Note.md')) && fs.existsSync(binned) && fs.readFileSync(binned, 'utf8') === noteText, 'deleted note is in the Bin with its text: ' + r.message);
sh(pc, 'pull', '-q'); ok(fs.existsSync(path.join(pc, '1 Human', '99 Bin', 'Note.md')) && !fs.existsSync(path.join(pc, '1 Human', 'Note.md')), 'PC sees it in the Bin too');
// same name again -> (2)
fs.writeFileSync(path.join(phone, 'Note.md'), 'second\n'); await syncVault(E()); fs.rmSync(path.join(phone, 'Note.md')); r = await syncVault(E());
ok(r.ok && fs.existsSync(path.join(phone, '1 Human', '99 Bin', 'Note (2).md')) && fs.readFileSync(binned, 'utf8') === noteText, 'a second note with the same name becomes "Note (2).md", the first is untouched');
// emptying the Bin is the user's own act and is recorded
fs.rmSync(path.join(phone, '1 Human', '99 Bin', 'Note (2).md')); r = await syncVault(E());
ok(r.ok && !fs.existsSync(path.join(phone, '1 Human', '99 Bin', 'Note (2).md')) && fs.readdirSync(path.join(phone, '1 Human', '99 Bin')).length === 1, 'emptying the Bin is recorded and does not create a Bin of the Bin');

server.close(); fs.rmSync(root, { recursive: true, force: true });
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
