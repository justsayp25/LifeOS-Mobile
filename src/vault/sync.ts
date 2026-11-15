// Vault sync through GitHub, using isomorphic-git. Nothing here knows about Android: the caller passes the file system and http client.
// Rule: never overwrite or delete anything. When both sides changed the same note, the remote version stays under the note's name
// and the phone's version is saved next to it as "Name (conflict <device> <date time>).ext".
import git from 'isomorphic-git';

export type Env = { fs: any; http: any; dir: string; url: string; token: string; device: string; branch?: string };
export type Result = { ok: boolean; saved: number; pulled: boolean; pushed: boolean; conflicts: string[]; message: string };

const auth = (token: string) => () => ({ username: 'x-access-token', password: token });
const author = (device: string) => ({ name: 'LifeOS ' + device, email: device.toLowerCase().replace(/\W+/g, '-') + '@lifeos.local' });
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');

/** Download the vault (first time). */
export async function cloneVault(e: Env, onProgress?: (msg: string) => void): Promise<void> {
  await git.clone({
    fs: e.fs, http: e.http, dir: e.dir, url: e.url, ref: e.branch, singleBranch: true, noCheckout: false, // full history on purpose: a shallow copy cannot be merged later
    onAuth: auth(e.token),
    onProgress: (p: any) => onProgress && onProgress(p.phase + (p.total ? ' ' + p.loaded + '/' + p.total : '')),
  });
}

export async function isCloned(e: Pick<Env, 'fs' | 'dir'>): Promise<boolean> {
  try { await git.resolveRef({ fs: e.fs, dir: e.dir, ref: 'HEAD' }); return true; } catch { return false; }
}

export const BIN_DIR = '1 Human/99 Bin';

/** A note deleted on the phone goes to the vault's Bin (flat, "(2)" for name clashes) instead of vanishing. Returns false if it could not be saved there. */
async function moveToBin(e: Env, file: string): Promise<boolean> {
  try {
    const head = await git.resolveRef({ fs: e.fs, dir: e.dir, ref: 'HEAD' });
    const { blob } = await git.readBlob({ fs: e.fs, dir: e.dir, oid: head, filepath: file });
    const name = file.slice(file.lastIndexOf('/') + 1);
    const taken = async (n: string) => { try { await e.fs.promises.stat(e.dir + '/' + BIN_DIR + '/' + n); return true; } catch { return false; } };
    let dest = name, k = 2;
    while (await taken(dest)) dest = name.replace(/(\.[^.]*)?$/, (m: string) => ' (' + k++ + ')' + m);
    await mkdirs(e, BIN_DIR);
    await e.fs.promises.writeFile(e.dir + '/' + BIN_DIR + '/' + dest, blob);
    await git.add({ fs: e.fs, dir: e.dir, filepath: BIN_DIR + '/' + dest });
    return true;
  } catch { return false; }
}

/** Save local changes as a commit. Returns how many files were included. */
async function commitLocal(e: Env): Promise<number> {
  const rows = await git.statusMatrix({ fs: e.fs, dir: e.dir });
  let n = 0;
  for (const [file, head, workdir, stage] of rows) {
    if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
    if (workdir === 0) {
      // deleted on the phone: keep a copy in the Bin (not for the Bin itself or Obsidian's own files)
      if (head === 1 && !file.startsWith(BIN_DIR + '/') && !file.startsWith('.obsidian/')) await moveToBin(e, file);
      await git.remove({ fs: e.fs, dir: e.dir, filepath: file });
    } else await git.add({ fs: e.fs, dir: e.dir, filepath: file });
    n++;
  }
  if (n) await git.commit({ fs: e.fs, dir: e.dir, message: 'LifeOS sync from ' + e.device + ' ' + stamp(), author: author(e.device) });
  return n;
}

/** Save, fetch, merge, push. Safe to run twice. */
export async function syncVault(e: Env): Promise<Result> {
  const r: Result = { ok: false, saved: 0, pulled: false, pushed: false, conflicts: [], message: '' };
  try {
    const branch = e.branch || (await git.currentBranch({ fs: e.fs, dir: e.dir })) || 'master';
    r.saved = await commitLocal(e);

    await git.fetch({ fs: e.fs, http: e.http, dir: e.dir, url: e.url, ref: branch, singleBranch: true, tags: false, onAuth: auth(e.token) });
    const theirs = await git.resolveRef({ fs: e.fs, dir: e.dir, ref: 'refs/remotes/origin/' + branch });
    const ours = await git.resolveRef({ fs: e.fs, dir: e.dir, ref: 'refs/heads/' + branch });

    const phoneIsAhead = theirs === ours || (await git.isDescendent({ fs: e.fs, dir: e.dir, oid: ours, ancestor: theirs, depth: -1 }).catch(() => false));
    if (!phoneIsAhead) {
      const conflicts: string[] = [];
      const mergeDriver = async ({ contents, path }: { contents: string[]; path: string }) => {
        // contents = [base, ours (phone), theirs (remote)]. Keep the remote under the original name; save the phone's next to it.
        const dot = path.lastIndexOf('.'), slash = path.lastIndexOf('/');
        const base = dot > slash ? path.slice(0, dot) : path, ext = dot > slash ? path.slice(dot) : '';
        const copy = base + ' (conflict ' + e.device + ' ' + stamp() + ')' + ext;
        await writeText(e, copy, contents[1]);
        conflicts.push(copy);
        return { cleanMerge: true, mergedText: contents[2] };
      };
      try {
        await git.merge({ fs: e.fs, dir: e.dir, ours: branch, theirs: 'refs/remotes/origin/' + branch, author: author(e.device), mergeDriver, abortOnConflict: true });
        await git.checkout({ fs: e.fs, dir: e.dir, ref: branch });
        r.pulled = true;
        if (conflicts.length) { r.conflicts = conflicts; r.saved += await commitLocal(e); } // the conflict copies are new files: commit them too
      } catch (err: any) {
        r.message = 'Not merged, nothing was changed: ' + (err && err.message ? err.message : String(err));
        return r;
      }
    }

    const push = await git.push({ fs: e.fs, http: e.http, dir: e.dir, url: e.url, ref: branch, remoteRef: branch, onAuth: auth(e.token) });
    r.pushed = !!push.ok;
    if (!push.ok) { r.message = 'Could not send: ' + (push.error || 'rejected'); return r; }
    r.ok = true;
    r.message = (r.pulled ? 'Received changes. ' : 'Nothing new to receive. ') + (r.saved ? 'Sent ' + r.saved + ' file(s).' : 'Nothing to send.') + (r.conflicts.length ? ' Both versions kept for ' + r.conflicts.length + ' note(s).' : '');
    return r;
  } catch (err: any) {
    r.message = (err && err.message) || String(err);
    return r;
  }
}

async function mkdirs(e: Env, rel: string) {
  let p = e.dir;
  for (const d of rel.split('/').filter(Boolean)) { p += '/' + d; try { await e.fs.promises.mkdir(p); } catch { /* exists */ } }
}
async function writeText(e: Env, rel: string, text: string) {
  const parts = rel.split('/'); parts.pop();
  await mkdirs(e, parts.join('/'));
  await e.fs.promises.writeFile(e.dir + '/' + rel, text, 'utf8');
}
