// A Node-style `fs.promises` on top of expo-file-system, which is what isomorphic-git needs.
import * as FS from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const uri = (p: string) => (p.startsWith('file://') ? p : 'file://' + p);
const err = (code: string, path: string) => Object.assign(new Error(code + ': ' + path), { code });

async function info(p: string) {
  const i: any = await FS.getInfoAsync(uri(p));
  return i;
}
function statOf(i: any) {
  const dir = !!i.isDirectory, mtimeMs = Math.round((i.modificationTime || 0) * 1000);
  return {
    type: dir ? 'dir' : 'file', mode: dir ? 0o40000 : 0o100644, size: dir ? 0 : i.size || 0,
    ino: 0, mtimeMs, ctimeMs: mtimeMs, uid: 1, gid: 1, dev: 1,
    isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => false,
  };
}

const promises = {
  async readFile(p: string, opts?: any) {
    const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
    const i = await info(p); if (!i.exists || i.isDirectory) throw err('ENOENT', p);
    if (enc === 'utf8') return FS.readAsStringAsync(uri(p), { encoding: FS.EncodingType.UTF8 });
    const b64 = await FS.readAsStringAsync(uri(p), { encoding: FS.EncodingType.Base64 });
    return Buffer.from(b64, 'base64');
  },
  async writeFile(p: string, data: string | Uint8Array, opts?: any) {
    if (typeof data === 'string') return FS.writeAsStringAsync(uri(p), data, { encoding: FS.EncodingType.UTF8 });
    return FS.writeAsStringAsync(uri(p), Buffer.from(data).toString('base64'), { encoding: FS.EncodingType.Base64 });
  },
  async unlink(p: string) {
    const i = await info(p); if (!i.exists) throw err('ENOENT', p);
    await FS.deleteAsync(uri(p), { idempotent: true });
  },
  async readdir(p: string) {
    const i = await info(p); if (!i.exists || !i.isDirectory) throw err('ENOENT', p);
    return FS.readDirectoryAsync(uri(p));
  },
  async mkdir(p: string) {
    const clean = p.replace(/\/+$/, '');
    if ((await info(clean)).exists) throw err('EEXIST', p);
    const parent = clean.slice(0, clean.lastIndexOf('/'));
    if (parent && !(await info(parent)).exists) throw err('ENOENT', p);
    await FS.makeDirectoryAsync(uri(clean), { intermediates: false });
  },
  async rmdir(p: string) {
    const i = await info(p); if (!i.exists) throw err('ENOENT', p);
    await FS.deleteAsync(uri(p), { idempotent: true });
  },
  async stat(p: string) { const i = await info(p); if (!i.exists) throw err('ENOENT', p); return statOf(i); },
  async lstat(p: string) { const i = await info(p); if (!i.exists) throw err('ENOENT', p); return statOf(i); },
  async readlink(p: string): Promise<string> { throw err('ENOSYS', p); },
  async symlink(_t: string, p: string): Promise<void> { throw err('ENOSYS', p); },
  async chmod() { /* not needed on shared storage */ },
};

export const fs = { promises };
