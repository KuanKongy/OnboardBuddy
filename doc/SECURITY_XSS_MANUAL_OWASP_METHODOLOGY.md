# OnboardBuddy — manual / OWASP-tooling methodology for the XSS test round

**Companion to [`doc/SECURITY_XSS_TEST_REPORT.md`](./SECURITY_XSS_TEST_REPORT.md).** That report
describes what was actually built and run this round: a custom Playwright harness
(`frontend/e2e/xss-forms.spec.ts`) and a custom API-bypass script
(`backend/scripts/security-probe.ts`), both reading a shared payload catalogue
(`backend/test/security/xssPayloads.json`).

This document answers a different question: **how would the same ground get covered by a human
tester working manually, or by OWASP's own tooling (ZAP), instead of a bespoke harness?**

Two things are kept strictly separate below, and neither should be read as the other:

- **Methodology** sections are *prescriptive* — how a tester would set this up and what it would
  look like. **OWASP ZAP was not installed or run this round** (confirmed: not present on this
  machine, and Docker — the usual way to run it — was down for the whole round). Nothing here is a
  ZAP scan log, alert export, or risk score; treat every ZAP-specific claim as "this is what the
  tool does," not "this is what it found."
- **Results** sections cite the *actual, already-verified* findings from
  `SECURITY_XSS_TEST_REPORT.md` — real HTTP responses, real DOM assertions, real fixes — with a
  note on which manual technique or ZAP feature would have surfaced the same thing.

## 1. Why a bespoke harness was built instead of just running ZAP

Three properties of this app push toward custom tooling over an out-of-the-box scanner run:

1. **Auth is a Supabase JWT in a header, not a cookie session.** ZAP's default authentication
   handling (form-based login + cookie jar) doesn't apply; you'd need Script-Based Authentication
   or a static header injected via ZAP's Replacer, and either way someone still has to mint a
   session (this round did that with a real Supabase magic-link flow —
   `backend/scripts/security-probe-seed.ts`).
2. **It's a client-rendered React SPA.** ZAP's traditional Spider only follows `<a href>`/`<form>`
   in server-rendered HTML; a SPA needs the **AJAX Spider** (drives a real/headless browser) to
   discover routes like `/projects/:id/settings` at all.
3. **The interesting question per field wasn't generic** ("does *a* payload execute") but specific
   and three-part: did it execute, did it round-trip byte-identical (not silently dropped), and did
   it render as zero live injected elements. A generic scanner alert is binary (vulnerable /
   not); this round needed the negative case proven with the same rigor as a positive would need,
   which is what drove writing assertions instead of reading an alerts list.

None of that means ZAP is the wrong tool in general — it means *this specific report* needed
per-field, per-payload proof beyond what a scanner's alert list gives you. The sections below show
where ZAP and manual testing *do* map cleanly onto this round's scope, and one place — LLM prompt
injection — where neither classic OWASP tooling nor the WSTG really has an answer yet.

## 2. Methodology map: OWASP Testing Guide (WSTG) ↔ what this round tested

The [OWASP Web Security Testing Guide (WSTG) v4.2](https://owasp.org/www-project-web-security-testing-guide/)
is the reference methodology; each row is a WSTG category/test this round's scope falls under, the
manual technique a human tester would use, and the equivalent ZAP mechanism.

| WSTG reference | This round's coverage | Manual technique | ZAP mechanism |
|---|---|---|---|
| WSTG-INFO (Information Gathering) | §2 input-point inventory | View source, browser DevTools "Elements" panel, click through every page noting `<input>`/`<textarea>` | Spider + AJAX Spider build a site tree; manually reviewed against DevTools rather than trusted blind |
| WSTG-INPV-01 (Reflected XSS) | F1–F3, F11 (query/param echo) | Type payload into field/URL param, submit, view rendered DOM (`view-source:`, Elements panel, right-click → Inspect) for literal `<script>`/`onerror` vs. escaped `&lt;script&gt;` | Passive scan flags reflected input; Active Scan's XSS rule injects its own payload set and checks for unescaped reflection in the response body |
| WSTG-INPV-02 (Stored XSS) | F5, F7, F9 (profile name, ignored paths, scope path — persist then reload) | Submit payload, **reload the page in a new tab/session** (stored ≠ reflected — must survive a fresh render), inspect DOM | Active Scan's persistent-XSS variant submits, then re-requests a page known to render the stored value, in two passes |
| WSTG-INPV-05 (SQL Injection) | §3.3, `S-01`–`S-03` | Manually enter `' OR '1'='1`, a syntax-breaking quote, a `UNION SELECT`; watch for a `500`, a DB error string, or a behavior change (e.g., extra rows) in the response | Active Scan's SQLi rule (boolean-based, error-based, and time-based blind variants) fires automatically against every discovered parameter |
| WSTG-SESS-05 (CSRF) | §3.4 | Author a standalone HTML file with an auto-submitting `<form>`/`fetch()` targeting the API from a different origin, open it in a browser with (if cookie-based) an active session, observe whether the state-changing request succeeds | ZAP's passive scanner flags forms without a visible anti-CSRF token; for header-auth APIs like this one, the real test is manual — a scanner can't know a header isn't cookie-attachable without being told the auth model |
| WSTG-ATHZ-04 (Insecure Direct Object References / IDOR) | §3.5 | With two distinct authenticated sessions (Burp/ZAP-style "match & replace" or two separate logged-in browser profiles), copy an authenticated request from user A, swap the `:id` for a resource owned by user B, resend, check the status/body | ZAP Context can hold two Users under one auth config; the "Access Control Testing" add-on scripts diff a scan run as User A vs User B, but for one specific membership-tier check like this app's, manual request-editing is more direct |
| WSTG-ERRH-01 (Improper Error Handling) | §5 fix #4 (error-handler status swallowing) | Send a malformed/oversized request and read the *exact* status code and body, not just "did it 500" | ZAP's passive scanner flags stack traces/verbose errors in responses; a swallowed *status code* (500 where 413 belongs) is a subtler case a generic scanner tends not to flag since 500 isn't itself "wrong" — this one is realistically a manual/code-review catch either way |
| WSTG-BUSL (Business Logic Testing) | §5 fix #2 (`ignored_paths` unbounded) | Submit a 250-entry array / a 400-character string where the UI only ever sends short values — a business-logic bound, not a syntax attack, so it needs a tester who's read the code/API contract, not a signature-based scanner | Not scanner-detectable by default; ZAP's Fuzzer can brute-force array length/string length if a tester defines that as the test up front |
| WSTG-CONF (Configuration & Deployment Management) | §3.6, §5e (CSP / security headers) | `curl -I` the response, or DevTools "Network" panel → Headers, and check for `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` | ZAP's passive scanner raises this out of the box, unprompted — "CSP Header Not Set," "X-Content-Type-Options Header Missing," etc. — one of the few places a stock scan genuinely beats manual review on raw coverage |
| OWASP API Security Top 10 — **API4:2023 Unrestricted Resource Consumption** | §5 fix #1 (no rate limit on the LLM-billed `ask` route) | Script N rapid identical requests, watch for a `429`/backoff; a manual tester has to know this route calls a paid LLM to know it's the one that matters | Not a default Active Scan rule; ZAP's Fuzzer can be pointed at a route N times, but *deciding which route deserves this test* is a manual/architectural judgment either way |
| **OWASP Top 10 for LLM Applications — LLM01:2025 Prompt Injection** | §3.7 (the P-01…P-10 catalogue, live github.com import) | No WSTG equivalent exists — this is inherently a manual, semantic test: craft text that *means* something adversarial to an LLM, feed it through the real ingestion path, and read the model's actual output for compliance | **ZAP has no built-in prompt-injection detection.** This is the clearest gap between classic web-app scanning and what this app's actual attack surface (an LLM in the request pipeline) needs — a scanner tuned for HTML/SQL/HTTP syntax has nothing to say about whether a model obeyed embedded English-language instructions |

## 3. What a fully manual pass would have looked like, end to end

No tooling beyond a browser, its DevTools, and `curl`:

1. **Recon.** Click every page, `Ctrl+U` to view source on each, and open DevTools → Elements to
   find inputs that exist only after interaction (e.g., the invite-email field, which is inside a
   dialog). Cross-check against a `grep` of the source — which is exactly what this round did in
   §2 of the main report, run first, then treated the WSTG-INFO pass as a *confirmation* of the
   grep rather than the other way around (grep is faster and can't miss a conditionally-rendered
   field the way a click-through session can).
2. **Per field, per payload (WSTG-INPV-01/02).** Type `<script>window.__xss='X-01'</script>` into
   the field, submit, then in DevTools Console type `window.__xss` and read `undefined` vs. a
   value — this is the manual equivalent of this round's `page.evaluate(() => window.__xss)`
   assertion. Then `Ctrl+U`/Inspect the rendered value: `&lt;script&gt;` (escaped, safe) vs. a live
   `<script>` tag in the Elements tree (executed or at least DOM-injected, not safe).
3. **API bypass (no direct WSTG line item — this is "don't trust the client" applied literally).**
   Open DevTools → Network, find the request the form made, right-click → "Copy as fetch" or "Copy
   as cURL," then replay it in the Console or a terminal with the payload edited directly into the
   JSON body — skipping the form's own `type="email"` or length constraints entirely. This is
   exactly the technique `backend/scripts/security-probe.ts` automated: it is *literally* "copy as
   cURL and edit the body," just scripted across 6 payloads × 4+ endpoints instead of done by hand
   once.
4. **CSRF (WSTG-SESS-05).** Save a local `.html` file:
   ```html
   <form action="http://localhost:3000/api/projects/<id>/settings" method="POST">
     <input name="ignored_paths" value="csrf-probe">
   </form>
   <script>document.forms[0].submit()</script>
   ```
   Open it directly in the browser (`file://`) and watch the Network tab for the response. For a
   cookie-session app this is the whole test; for this app the useful manual step is instead
   opening DevTools and confirming the actual request has **no `Authorization` header attached**
   (the browser has nothing to auto-attach — header auth was never in a cookie jar to begin with),
   which is the structural reason CSRF doesn't apply here, read directly rather than inferred.
5. **IDOR (WSTG-ATHZ-04).** Log in as two different accounts in two browser profiles (or one
   normal + one Incognito window), copy an authenticated request from profile A via DevTools, paste
   it into profile B's Console with B's own bearer token, change only the `:id`, and read the
   status code.
6. **SQLi (WSTG-INPV-05).** Paste `' OR '1'='1` and `'; DROP TABLE project_members;--` into any
   text field that reaches the database, submit, and read: an error page (bad — leaks internals or
   proves an unparameterized query), a `500` with a generic body (better, but check with the DB
   directly that nothing was actually dropped), or a normal response treating it as inert text
   (best). This round confirmed the last case, then independently checked table row counts before
   and after via a direct database query — a step a purely black-box manual tester without DB
   access couldn't take, and one reason the actual round mixed black-box HTTP testing with
   white-box code reading (`grep` for string-concatenated SQL) rather than relying on response
   behavior alone.

## 4. What OWASP ZAP specifically would add, and how it would be configured

Concrete setup, described so it's reproducible — **not run this round**:

1. **Launch.** `docker run -p 8080:8080 zaproxy/zap-stable zap.sh -daemon -host 0.0.0.0 -port 8080`
   (the project's own Docker Desktop was down all round, which is itself why this wasn't run), or
   the native Windows ZAP installer.
2. **Context + scope.** New Context named `onboardbuddy`, scope `http://localhost:5173/*` and
   `http://localhost:3000/api/*` (both — the SPA shell and the API it calls need separate scoping
   since the SPA is client-rendered).
3. **Authentication.** No form-login exists to point ZAP's built-in Form-Based Auth at. The correct
   setup is **Script-Based Authentication** (a small JS auth script replicating what
   `security-probe-seed.ts` already does: hit Supabase's `verifyOtp` and capture the returned
   `access_token`), or more simply, **Tools → Replacer**: add a rule that appends
   `Authorization: Bearer <token>` to every outgoing request in scope. The latter is simpler but
   the token is static for the session — fine for a bounded test run, wrong for anything long-lived
   since Supabase JWTs expire.
4. **AJAX Spider**, not the traditional Spider — `frontend-dev` serves a client-rendered SPA;
   the traditional Spider would see one HTML shell and stop. AJAX Spider drives a real (or
   headless) browser, so it discovers `/projects/:id/settings`, `/projects/:id/team`, etc. by
   actually clicking through, the same way `xss-forms.spec.ts` navigates via `page.goto()`.
5. **Passive Scan** runs automatically on every proxied request/response during the spider —
   this is where the dev-server-has-no-CSP observation (§3.6 of the main report) would surface
   unprompted, as would missing `X-Content-Type-Options`, cookie flags (moot here — no
   session cookies), and similar. No attack traffic sent; this alone is "free" coverage.
6. **Active Scan**, scoped to the API endpoints AJAX Spider found, with an explicit Scan Policy:
   enable the **Cross Site Scripting (Reflected)**, **Cross Site Scripting (Persistent)**, and
   **SQL Injection** rules at High threshold/strength; leave path-traversal, XXE, and command-injection
   rules on since they're irrelevant-but-harmless here rather than worth the setup cost of pruning.
   This is the automated equivalent of §3.2/§3.3 of the main report, minus the specific
   `xssPayloads.json` catalogue and its `XSSMARK<nn>` round-trip proof — ZAP's own built-in payload
   set for these rules is broader but generic, and it would report "reflected/executed" or not; it
   would **not** on its own distinguish "silently dropped" from "safely escaped" the way this
   round's marker-presence assertion did, because that distinction was written specifically for
   this report's central question.
7. **Fuzzer**, for exact parity with the actual payload catalogue: right-click any captured request
   in the History tab → Attack → Fuzz, mark the `ignored_paths`/`question`/`email` field value as
   the injection point, attach a custom payload file built from
   `backend/test/security/xssPayloads.json`'s six XSS and three SQLi entries, run, and read the
   response-length/status-code column per payload — this is the closest 1:1 manual-tool
   reconstruction of what `security-probe.ts`'s loop over `catalogue.xss`/`catalogue.sqli` did
   programmatically.
8. **Report.** ZAP's "Generate Report" (HTML/JSON/Markdown) produces an Alerts list with Risk
   (High/Medium/Low/Informational), Confidence, CWE ID, and a Solution field per finding — useful
   for a compliance audience expecting a standard scanner report format; it would not contain the
   per-payload pass/fail table or the "structural reason" narrative (§3–§4 of the main report) that
   answers *why* something is safe, which mattered for this round's specific ask.

## 5. Results — the same findings, cited from the actual round

Everything below already happened and was verified in `SECURITY_XSS_TEST_REPORT.md`; this section
only reframes it under the WSTG/ZAP lens above. No new testing was performed to produce this
section.

| Finding | WSTG / OWASP reference | Where it's proven in the main report |
|---|---|---|
| No XSS executes anywhere tested — 19/19 live browser cases, all API-bypass cases | WSTG-INPV-01/02 | §3.1, §3.2, §4 |
| SQLi negative, structurally (100% parameterized) | WSTG-INPV-05 | §3.3 |
| CSRF negative, structurally (header auth, not cookie) | WSTG-SESS-05 | §3.4 |
| IDOR/tier checks hold under live attack | WSTG-ATHZ-04 | §3.5 |
| Dev server has no CSP (expected — nginx-layer, prod-only control) | WSTG-CONF | §3.6 |
| Prompt injection into the LLM pipeline: 0/10 payloads survived into generated docs | OWASP LLM01:2025 (no WSTG equivalent) | §3.7 |
| Global error handler discarded real HTTP status codes | WSTG-ERRH-01 | §5 fix #4 |
| `ignored_paths` accepted unbounded/unvalidated input | WSTG-BUSL | §5 fix #2 |
| No rate limit on the LLM-billed `ask` route | OWASP API Security Top 10 — API4:2023 | §5 fix #1 |
| Dead `cors({credentials:true})` under header-based auth | Architecture review, not scanner-detectable | §5 fix #3 |

## 6. Changes made as a result

Identical to `SECURITY_XSS_TEST_REPORT.md` §5 — repeated here only so this document is readable
without cross-referencing every line, not because anything additional was fixed under this
methodology:

1. **Ask-route rate limiter** — 20 requests / 5 minutes per user, `429` on the LLM-billed route
   only. `backend/src/api/middleware/askRateLimit.ts`.
2. **`ignored_paths` shape/size bound** — reject non-array, >200 entries, or any entry >400
   characters, `400`. Deliberately a shape/DoS bound, not a content filter — the actual XSS control
   stays React's render-time escaping. `backend/src/api/routes/projects.ts`.
3. **Removed dead `cors({credentials:true})`** — no cookie-based flow exists anywhere in the API to
   justify it. `backend/src/api/app.ts`.
4. **Error handler now forwards real 4xx status codes** (narrowly, only integers 400–499 from
   recognized error shapes) instead of always answering `500`. `backend/src/api/app.ts`.

No finding in this document's reframing surfaced anything the main report's own decision rule
(§8 of the plan; §5 of the report) would have handled differently — same severities, same fixes,
same things deliberately left as documented follow-ups (the malformed-`:id`-param status code).

## 7. Where each approach is stronger

| | Custom harness (what was actually run) | Manual testing | OWASP ZAP |
|---|---|---|---|
| Auth handling for a JWT-header SPA | Native — the harness *is* the auth flow | Manual, but transparent — a human reads exactly what's attached | Needs Script-Based Auth or a static Replacer rule; not out-of-the-box |
| Proving "safely escaped" vs. "silently dropped" | Built for exactly this — the `XSSMARK<nn>` marker check | Possible, tedious at scale (11 fields × up to 6 payloads by hand) | Not distinguished by default; would need custom scan-rule scripting |
| Coverage breadth across unrelated vuln classes (path traversal, XXE, command injection, etc.) | None — scoped to this report's exact question | Only what the tester thinks to try | Broad, automatic, "for free" once scoped |
| Repeatability / CI integration | Yes — `npm run security:probe`, `npx playwright test`, both scripted | No | Yes — Automation Framework (YAML plans), `zap-baseline.py` |
| Standard compliance-report format (CWE/WASC IDs, risk ratings) | No | No | Yes |
| Business-logic bounds specific to this app (e.g. `ignored_paths` size) | Yes — required knowing the API contract either way | Yes — same requirement | Only if a tester defines the Fuzzer test up front; not autodetected |
| LLM prompt-injection testing | Yes — the one thing this app most needs tested that generic tools don't cover | Yes, if the tester thinks to test it | **No built-in support** |

The realistic answer for a repo like this: run ZAP's passive scan and a scoped active scan for
broad, cheap, standard-format coverage (headers, generic injection classes), and keep a small
custom harness — like the one this round built — for the two things a generic scanner structurally
cannot do here: prove the specific negative this report's central question asked for, and test
prompt injection against the app's actual LLM pipeline at all.
