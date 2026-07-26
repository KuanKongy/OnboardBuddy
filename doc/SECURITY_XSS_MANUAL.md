# OnboardBuddy — manual XSS test round

1. **Recon.** Click every page, `Ctrl+U` to view source on each, and open DevTools → Elements to
   find inputs that exist only after interaction (e.g., the invite-email field, which is inside a
   dialog). 
2. **Per field.** Type `<script>window.__xss='X-01'</script>` into
   the field, submit, then in DevTools Console type `window.__xss` and read `undefined` vs. a
   value. Then `Ctrl+U`/Inspect the rendered value: `&lt;script&gt;` (escaped, safe) vs. a live
   `<script>` tag in the Elements tree
3. **API bypass.**
   Open DevTools → Network, find the request the form made, right-click → "Copy as fetch" or "Copy
   as cURL," then replay it in the Console or a terminal with the payload edited directly into the
   JSON body — skipping the form's own `type="email"` or length constraints entirely.
4. **CSRF.** Save a local `.html` file:
   ```html
   <form action="http://localhost:3000/api/projects/<id>/settings" method="POST">
     <input name="ignored_paths" value="csrf-probe">
   </form>
   <script>document.forms[0].submit()</script>
   ```
   Open it directly in the browser (`file://`) and watch the Network tab for the response. 
   Opening DevTools and confirming the actual request has **no `Authorization` header attached**.
5. **IDOR.** Log in as two different accounts in two browsers, copy an authenticated request 
   from profile A via DevTools, paste it into profile B's Console with B's own bearer token,
   change only the `:id`, and read the status code.
6. **SQLi.** Paste `' OR '1'='1` and `'; DROP TABLE project_members;--` into any
   text field that reaches the database, submit, and read: an error page, a `500` with a generic 
   body, or a normal response treating it as inert text. 

## Additional OWASP ZAP steps
3. **Script-Based Authentication** hit Supabase's `verifyOtp` and capture the returned
   `access_token`, or more simply, **Tools → Replacer**: add a rule that appends
   `Authorization: Bearer <token>` to every outgoing request in scope.
4. **AJAX Spider** drives a real browser, so it discovers `/projects/:id/settings`, `/projects/:id/team`, 
   etc. by actually clicking through
5. **Passive Scan** runs automatically on every proxied request/response during the spider 
6. **Active Scan**, scoped to the API endpoints AJAX Spider found, with an explicit Scan Policy:
   enable the **Cross Site Scripting (Reflected)**, **Cross Site Scripting (Persistent)**, and
   **SQL Injection** rules at High threshold/strength
7. **Fuzzer**, for exact parity with the actual payload catalogue: right-click any captured request
   in the History tab → Attack → Fuzz, mark the `ignored_paths`/`question`/`email` field value as
   the injection point, attach a custom payload file built from
   `backend/test/security/xssPayloads.json`'s six XSS and three SQLi entries, run, and read the
   response-length/status-code column per payload
8. **Report.** ZAP's "Generate Report" (HTML/JSON/Markdown) produces an Alerts list with Risk
   (High/Medium/Low/Informational), Confidence, CWE ID, and a Solution field per finding

## Results

- No XSS executes anywhere tested 
- SQLi negative, structurally
- CSRF negative, structurally
- IDOR/tier checks hold under live attack
- Dev server has no CSP
- Prompt injection into the LLM pipeline: 0/10 payloads survived into generated docs
- Global error handler discarded real HTTP status codes
- `ignored_paths` accepted unbounded/unvalidated input
- No rate limit on the LLM-billed `ask` route

## Changes made

1. **Ask-route rate limiter** — 20 requests / 5 minutes per user, `429` on the LLM-billed route
   only. `backend/src/api/middleware/askRateLimit.ts`.
2. **`ignored_paths` shape/size bound** — reject non-array, >200 entries, or any entry >400
   characters, `400`. Deliberately a shape/DoS bound, not a content filter — the actual XSS control
   stays React's render-time escaping. `backend/src/api/routes/projects.ts`.
4. **Error handler now forwards real 4xx status codes** (narrowly, only integers 400–499 from
   recognized error shapes) instead of always answering `500`. `backend/src/api/app.ts`.