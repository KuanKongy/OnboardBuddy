/**
 * Parsing for GitHub App installation ids arriving from a query string or a
 * JSON body (bug #8).
 *
 * Two mistakes are being avoided, and both are about *what question the guard
 * asks*:
 *
 * 1. `if (!Number(raw))` asks "is it falsy?" — which reports `0` as missing.
 *    The question that matters is "was a value supplied?", and the answer to
 *    that is independent of the value. Every numeric id the API grows later
 *    would inherit the same defect from the same idiom.
 * 2. `Number(raw)` is far more permissive than an id format: it accepts
 *    `"0x2329"`, `"1e4"`, `" 9001 "`, `"9001.5"`, `"-9001"` and `"Infinity"`.
 *    That matters beyond tidiness — `POST /projects` stores the *raw* string in
 *    a `text` column while authorizing with the parsed number, so `"0x2329"`
 *    would authorize as installation 9001 and persist as `"0x2329"`, which the
 *    webhook's string comparison against GitHub's `"9001"` never matches again.
 *    Requiring plain decimal digits keeps the stored and authorized values the
 *    same token.
 *
 * `0` parses successfully on purpose. GitHub does not issue it, so it is
 * rejected one layer down by the ownership check as "not one of yours" (403) —
 * which is the truthful answer — rather than mislabelled "required" (400).
 */
export type InstallationIdParse =
  | { ok: true; value: number }
  | { ok: false; reason: "absent" | "malformed" };

export function parseInstallationId(raw: unknown): InstallationIdParse {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, reason: "absent" };
  }

  // A JSON body may legitimately send a number rather than a string.
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0
      ? { ok: true, value: raw }
      : { ok: false, reason: "malformed" };
  }

  // Repeated query params arrive as an array; anything else is not an id.
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return { ok: false, reason: "malformed" };
  }

  const value = Number(raw);
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, reason: "malformed" };
}
