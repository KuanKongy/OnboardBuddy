import { normalizeAmount } from '../internal/normalize';

export function add(a: number, b: number): number {
  return normalizeAmount(a) + normalizeAmount(b);
}

export function subtract(a: number, b: number): number {
  return normalizeAmount(a) - normalizeAmount(b);
}

export function allocate(amount: number, ratios: number[]): number[] {
  const total = ratios.reduce((s, r) => s + r, 0);
  const cents = normalizeAmount(amount);
  return ratios.map((r) => Math.round((cents * r) / total));
}

export function formatMoney(amount: number, currency: string): string {
  return `${(normalizeAmount(amount) / 100).toFixed(2)} ${currency}`;
}

export const ZERO = 0;
