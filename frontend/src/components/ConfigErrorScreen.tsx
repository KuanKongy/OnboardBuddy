/**
 * Shown instead of the app when the deployment supplied no runtime
 * configuration (see `lib/runtimeConfig.ts`).
 *
 * The failure this replaces is a blank page: `createClient("", "")` throws
 * while the module graph is still evaluating, so nothing ever mounts and the
 * only clue is one line in the browser console. Someone deploying this for the
 * first time should instead be told which variable is missing and where to put
 * it.
 *
 * Deliberately dependency-free — no UI kit, no context, no `@/lib/api`, and
 * inline styles rather than Tailwind classes. This screen has to render on the
 * one path where the rest of the app cannot be trusted to load, so it must not
 * import anything that could itself fail, and it must stay legible even if the
 * stylesheet never arrived.
 */

import type { CSSProperties } from "react";

const SETTINGS: Record<string, string> = {
  VITE_API_URL: "Base URL of the backend API, e.g. https://your-api.up.railway.app/api",
  VITE_SUPABASE_URL: "Supabase project URL, e.g. https://abcdefgh.supabase.co",
  VITE_SUPABASE_ANON_KEY: "Supabase publishable (anon) key",
};

const shell: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem",
  background: "#0c1c3b",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const card: CSSProperties = {
  maxWidth: "42rem",
  width: "100%",
  background: "#ffffff",
  color: "#0c1c3b",
  borderRadius: "0.75rem",
  padding: "2rem",
  boxShadow: "0 20px 45px rgba(0,0,0,0.35)",
  lineHeight: 1.6,
};

const code: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: "0.875rem",
  background: "#eef1f8",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.35rem",
};

export function ConfigErrorScreen({ missing }: { missing: readonly string[] }) {
  // `missing` is empty on the other path that would otherwise be a blank page:
  // the app chunk itself failed to load (a cached index.html pointing at hashed
  // assets a newer deploy removed). Same shell, honest wording.
  const bundleFailure = missing.length === 0;

  return (
    <div style={shell} role="alert">
      <div style={card}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
          {bundleFailure ? "OnboardBuddy failed to start" : "OnboardBuddy is not configured"}
        </h1>
        <p style={{ margin: "0 0 1.25rem", color: "#3d4a66" }}>
          {bundleFailure ? (
            <>
              The application bundle could not be loaded. If this page was open across a
              deployment, reload it (hard-refresh) — the browser may be holding a stale
              index. Otherwise check the frontend container&rsquo;s logs.
            </>
          ) : (
            <>
              The frontend loaded, but it was not told where its backend lives, so it stopped
              instead of failing later with an unexplained error. Set the value
              {missing.length === 1 ? "" : "s"} below and restart the frontend container — no
              rebuild is needed.
            </>
          )}
        </p>

        <ul style={{ margin: "0 0 1.25rem", paddingLeft: "1.25rem" }}>
          {missing.map((name) => (
            <li key={name} style={{ marginBottom: "0.5rem" }}>
              <code style={code}>{name}</code>
              <span style={{ color: "#3d4a66" }}>
                {" — "}
                {SETTINGS[name] ?? "required"}
              </span>
            </li>
          ))}
        </ul>

        <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
          {bundleFailure ? "Configuration lives here" : "Where to set it"}
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#3d4a66" }}>
          <li style={{ marginBottom: "0.35rem" }}>
            <strong>Docker Compose:</strong> in <code style={code}>frontend/.env</code>, then{" "}
            <code style={code}>docker compose up -d frontend</code>.
          </li>
          <li>
            <strong>Railway or another host:</strong> as service variables on the frontend
            service, then redeploy or restart it.
          </li>
        </ul>
      </div>
    </div>
  );
}
