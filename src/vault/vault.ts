// The phone's copy of the vault: a normal shared folder (so Claude Code in Termux can read it too), synced with the private GitHub repo.
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { fs } from './expoFs';
import { http } from './http';
import { cloneVault, isCloned, syncVault, type Env, type Result } from './sync';

export const VAULT_DIR = '/storage/emulated/0/LifeOS';
export const REPO_URL = 'https://github.com/justsayp25/LifeOS.git';
export const BRANCH = 'master';
const DEVICE = 'phone';
const K_TOKEN = 'lifeos.githubToken', K_LAST = 'lifeos.lastSync';

const safe = async <T>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f(); } catch { return d; } };
export const getToken = () => safe(() => SecureStore.getItemAsync(K_TOKEN), null as string | null);
export const setToken = (t: string) => SecureStore.setItemAsync(K_TOKEN, t.trim());
export const clearToken = () => safe(() => SecureStore.deleteItemAsync(K_TOKEN), undefined);
export const getLastSync = () => safe(() => SecureStore.getItemAsync(K_LAST), null as string | null);

const env = (token: string): Env => ({ fs, http, dir: VAULT_DIR, url: REPO_URL, token, device: DEVICE, branch: BRANCH });
const U = (p: string) => 'file://' + p;

export async function vaultReady(): Promise<boolean> { return isCloned({ fs, dir: VAULT_DIR }); }

/** Counts the notes and files (not the hidden .git folder). */
export async function countFiles(dir = VAULT_DIR): Promise<number> {
  let n = 0;
  for (const name of await FS.readDirectoryAsync(U(dir))) {
    if (name === '.git') continue;
    const i: any = await FS.getInfoAsync(U(dir + '/' + name));
    n += i.isDirectory ? await countFiles(dir + '/' + name) : 1;
  }
  return n;
}

/** First download. Refuses to touch a folder that already holds other files: nothing is ever overwritten. */
export async function downloadVault(token: string, onProgress: (m: string) => void): Promise<void> {
  const i: any = await FS.getInfoAsync(U(VAULT_DIR));
  if (!i.exists) await FS.makeDirectoryAsync(U(VAULT_DIR), { intermediates: true });
  else {
    const names = await FS.readDirectoryAsync(U(VAULT_DIR));
    if (names.length && !(await isCloned({ fs, dir: VAULT_DIR }))) {
      // a half-finished earlier download leaves only .git; that is ours to clear. Anything else is yours: stop.
      if (names.length === 1 && names[0] === '.git') await FS.deleteAsync(U(VAULT_DIR + '/.git'), { idempotent: true });
      else throw new Error('The folder ' + VAULT_DIR + ' already has other files in it, so I did not download into it. Move or rename it, then try again.');
    }
  }
  if (await isCloned({ fs, dir: VAULT_DIR })) return;
  await cloneVault(env(token), onProgress);
}

export async function sync(token: string): Promise<Result> {
  const r = await syncVault(env(token));
  if (r.ok) await safe(() => SecureStore.setItemAsync(K_LAST, new Date().toISOString()), undefined);
  return r;
}
