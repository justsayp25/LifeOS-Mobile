import { requireNativeModule } from 'expo';

type TermuxRunType = {
  isInstalled(): Promise<boolean>;
  run(path: string, args: string[], workdir: string, background: boolean): Promise<boolean>;
  open(): Promise<boolean>;
};

export default requireNativeModule<TermuxRunType>('TermuxRun');
