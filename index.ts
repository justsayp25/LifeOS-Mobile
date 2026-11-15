import { Buffer } from 'buffer';
// isomorphic-git expects Node's Buffer; React Native does not have one.
(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
