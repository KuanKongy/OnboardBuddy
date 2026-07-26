import { Ledger } from './core/ledger';
import type { Entry } from './types';

/** Default export, re-exported by the barrel as `createLedger`. */
export default function createLedger(seed: Entry[] = []): Ledger {
  const ledger = new Ledger();
  for (const entry of seed) ledger.append(entry);
  return ledger;
}
