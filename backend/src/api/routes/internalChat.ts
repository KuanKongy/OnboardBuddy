import { Router } from "express";

/**
 * Minimal internal chat page (doc/Pipeline.md "Q&A Evaluation Endpoint"):
 * a dev-only evaluation tool for grounded answer quality — NOT a product
 * feature. Served only outside production (or with INTERNAL_CHAT_ENABLED=1).
 * Self-contained HTML; auth = paste a bearer token, same as any API call.
 */
export const internalChatRouter = Router();

export function internalChatEnabled(): boolean {
  return process.env.INTERNAL_CHAT_ENABLED === "1" || process.env.NODE_ENV !== "production";
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>OnboardBuddy — internal Q&A eval</title>
<style>
  body { font-family: ui-monospace, monospace; max-width: 860px; margin: 2rem auto; padding: 0 1rem; background:#111; color:#ddd; }
  input, textarea, select { width: 100%; box-sizing: border-box; background:#1c1c1c; color:#ddd; border:1px solid #444; padding:.5rem; margin:.25rem 0 .75rem; font: inherit; }
  button { background:#2d5; color:#111; border:0; padding:.5rem 1.5rem; font:inherit; cursor:pointer; }
  .answer { white-space: pre-wrap; background:#1c1c1c; border:1px solid #333; padding:1rem; margin-top:1rem; }
  .receipt { border-left: 3px solid #2d5; margin:.5rem 0; padding:.25rem .75rem; font-size:.85em; color:#9a9; }
  .receipt pre { white-space:pre-wrap; color:#bcb; margin:.25rem 0 0; }
  .meta { color:#777; font-size:.8em; }
  .low { color:#e66; } .medium { color:#ea3; } .high { color:#2d5; }
</style></head><body>
<h2>Q&amp;A eval <span class="meta">(internal dev tool — answers are audited, never stored)</span></h2>
<label>Bearer token</label><input id="token" type="password" placeholder="supabase access token">
<label>Project id</label><input id="project" placeholder="uuid">
<div style="display:flex;gap:1rem">
  <div style="flex:1"><label>Role</label><select id="role"><option value="">(default)</option><option>backend</option><option>frontend</option><option>devops</option><option>qa</option><option>general</option></select></div>
  <div style="flex:2"><label>Snapshot id (optional)</label><input id="snapshot" placeholder="latest complete snapshot when empty"></div>
</div>
<label>Question</label><textarea id="question" rows="3" placeholder="What handles user authentication?"></textarea>
<button id="ask">Ask</button>
<div id="out"></div>
<script>
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.getElementById('ask').onclick = async () => {
  const out = document.getElementById('out');
  out.innerHTML = '<p class="meta">asking…</p>';
  try {
    const body = { question: document.getElementById('question').value };
    const role = document.getElementById('role').value; if (role) body.role = role;
    const snap = document.getElementById('snapshot').value.trim(); if (snap) body.snapshot_id = snap;
    const res = await fetch('/api/projects/' + document.getElementById('project').value.trim() + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + document.getElementById('token').value.trim() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<div class="answer low">HTTP ' + res.status + ': ' + esc(data.error) + '</div>'; return; }
    const a = data.answer;
    out.innerHTML =
      '<div class="answer">' + esc(a.answerMarkdown) + '</div>' +
      '<p class="meta">confidence: <span class="' + esc(a.confidence) + '">' + esc(a.confidence) + '</span>' +
      ' · intent: ' + esc(a.meta.intent) + ' · views: ' + esc(a.meta.views.join(', ')) +
      (a.meta.retried ? ' · retried after validation failure' : '') + '</p>' +
      (a.unknowns.length ? '<p class="meta">unknowns: ' + esc(a.unknowns.map(u => u.kind).join(', ')) + '</p>' : '') +
      a.receipts.map(r =>
        '<div class="receipt">' + esc(r.filePath ?? '') + (r.lineStart ? ' L' + r.lineStart + '-' + r.lineEnd : '') +
        ' [' + esc(r.trustLevel) + ']' + (r.snippet ? '<pre>' + esc(r.snippet) + '</pre>' : '') + '</div>'
      ).join('');
  } catch (err) { out.innerHTML = '<div class="answer low">' + esc(err.message) + '</div>'; }
};
</script></body></html>`;

internalChatRouter.get("/", (_req, res) => {
  if (!internalChatEnabled()) {
    res.status(404).json({ error: "Not Found" });
    return;
  }
  res.type("html").send(PAGE);
});
