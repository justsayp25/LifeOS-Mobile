import { requireNativeModule } from 'expo';

type TermuxRunType = {
  isInstalled(): Promise<boolean>;
  run(path: string, args: string[], workdir: string, background: boolean): Promise<boolean>;
  open(): Promise<boolean>;
};

// If the native part is missing the app must still open: the start screen then falls back to the copy-able command.
let mod: TermuxRunType;
try {
  mod = requireNativeModule<TermuxRunType>('TermuxRun');
} catch {
  const no = async () => { throw new Error('The Termux start button is not available in this build.'); };
  mod = { isInstalled: async () => false, run: no as any, open: async () => false };
}
export default mod;
