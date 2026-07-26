import { normalizeAmount } from '../internal/normalize';
import type { Balance, Entry, Posting } from '../types';

export class Ledger {
  private entries: Entry[] = [];

  append(entry: Entry): void {
    this.entries.push({ ...entry, postings: entry.postings.map(normalizePosting) });
  }

  balanceOf(account: string): Balance {
    const total = this.entries
      .flatMap((e) => e.postings)
      .filter((p) => p.account === account)
      .reduce((sum, p) => sum + normalizeAmount(p.amount), 0);
    return { account, total };
  }

  all(): readonly Entry[] {
    return this.entries;
  }
}

export function normalizePosting(posting: Posting): Posting {
  return { ...posting, amount: normalizeAmount(posting.amount) };
}

export function isBalanced(entry: Entry): boolean {
  return entry.postings.reduce((sum, p) => sum + normalizeAmount(p.amount), 0) === 0;
}

export function mergeLedgers(left: Ledger, right: Ledger): Ledger {
  const merged = new Ledger();
  for (const entry of [...left.all(), ...right.all()]) merged.append(entry);
  return merged;
}

export const EMPTY_BALANCE: Balance = { account: '', total: 0 };
