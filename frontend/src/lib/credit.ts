/**
 * The GET /me/credit contract, mirrored for the browser. The server's copy is
 * `CreditStatus` in backend/src/api/services/creditGate.ts; the two have to stay
 * in step. Shared by the analyze dialog's meter and the Usage section of Account
 * Settings so the money wording is written once.
 */

/**
 * Why the gate said no. The listed codes are the ones the UI branches on, but
 * the field stays open to any string: the backend adds codes on its own
 * schedule, and an unrecognised one has to fall through to the generic copy
 * rather than break the build or blank a render.
 */
export type CreditReason =
  | "ok"
  | "monthly_exhausted"
  | "rate_limited"
  | "analysis_in_progress"
  | "blocked"
  | (string & {});

/**
 * The account's analysis credit, fixed contract from GET /me/credit. A credit
 * is CA$1 of analysis. The monthly allotment is the primary read; the pace (a
 * rolling-window rate cap) is a secondary aside shown only when it is the
 * binding constraint. The monthly* / rate* nullable fields are null on the dev
 * tier, which is unlimited.
 */
export interface Credit {
  tier: "free" | "pro" | "max" | "dev";
  monthlyCredits: number | null;
  monthlyUsed: number;
  monthlyRemaining: number | null;
  monthResetAt: string;
  rateCredits: number | null;
  rateWindowHours: number | null;
  rateUsed: number;
  rateResetAt: string | null;
  inFlight: number;
  allowed: boolean;
  reason: CreditReason;
}

/** CA$ amount, two decimals. A credit is CA$1, and spend can be fractional. */
export const ca = (n: number) => `CA$${n.toFixed(2)}`;

/** Future-facing relative time for a reset, e.g. "in 3h". The endpoint hands
 *  back an ISO instant; a past or unparseable one degrades to "soon" rather
 *  than printing "in -2h". */
export function resetsRelative(iso: string): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "soon";
  const sec = Math.round((at - Date.now()) / 1000);
  if (sec <= 60) return "soon";
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  return `in ${Math.round(hr / 24)}d`;
}
