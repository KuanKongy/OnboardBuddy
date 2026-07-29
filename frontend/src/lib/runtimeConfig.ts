/**
 * The frontend's deployment configuration — API origin, Supabase project, and
 * Supabase publishable key — resolved at **runtime** rather than baked into the
 * bundle at build time.
 *
 * Why this exists (issue #73). Vite inlines `import.meta.env.VITE_*` into the
 * JavaScript at build time. The production image is nginx serving that static
 * `dist`, so a build-time origin pins one image to exactly one API host — which
 * makes a Railway deploy impossible, because the API's `*.up.railway.app`
 * hostname only exists after the image does. It is also why the CSP had to name
 * `http://localhost:3000` explicitly.
 *
 * How it is resolved, in order:
 *
 *  1. `window.__ONBOARDBUDDY_CONFIG__`, set by `/config.js`. In a container that
 *     file is written at startup by
 *     `frontend/docker-entrypoint.d/10-onboardbuddy-runtime-config.sh` from the
 *     process environment. `index.html` loads it as a plain, synchronous,
 *     same-origin `<script src>` before the app module, so the values are
 *     present on the first line the app runs — no boot fetch, no round trip to
 *     the API, no 404 path to handle.
 *  2. Otherwise `import.meta.env.VITE_*` — the Vite dev server and `vite
 *     preview` reading `frontend/.env`. This is what keeps `npm run dev`
 *     working exactly as before.
 *
 * The runtime object is **authoritative when it exists**: if `/config.js`
 * declares the global but a value is empty, that key is reported missing rather
 * than silently falling back to a build-time value. A silent fallback is how a
 * deployed app quietly starts calling `localhost`, which is the bug this module
 * removes. The container image is built with `frontend/.env` deleted, so there
 * is nothing to fall back to anyway.
 *
 * Nothing here is secret. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are
 * public by design (the anon key is RLS-gated and ships in every browser
 * session). The mechanism only ever publishes the three keys named in
 * `CONFIG_KEYS` — it never enumerates the environment — so adding a secret to
 * the frontend service's variables cannot leak it into the page.
 */

/** Shape the rest of the app consumes. Values are `""` when unconfigured. */
export type RuntimeConfig = {
  /** Base URL of the API, no trailing slash. Absolute, or a same-origin path. */
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

/** Name of the global `/config.js` assigns to. Also used by the shell script. */
export const RUNTIME_CONFIG_GLOBAL = "__ONBOARDBUDDY_CONFIG__";

/**
 * The complete set of values this mechanism will publish to the browser, and
 * the environment variable that supplies each one. Deliberately an explicit
 * list, not a `VITE_*` prefix scan: a scan would publish any future variable
 * that happened to be named with the prefix.
 */
export const CONFIG_KEYS: ReadonlyArray<readonly [keyof RuntimeConfig, string]> = [
  ["apiUrl", "VITE_API_URL"],
  ["supabaseUrl", "VITE_SUPABASE_URL"],
  ["supabaseAnonKey", "VITE_SUPABASE_ANON_KEY"],
];

export type RuntimeConfigResolution = {
  config: RuntimeConfig;
  /** Env-var names with no usable value. Non-empty ⇒ the app must not boot. */
  missing: string[];
  /** Which of the two sources supplied the values, for diagnostics. */
  source: "runtime" | "build";
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pure resolver, exported for tests.
 *
 * @param runtime  candidate `window.__ONBOARDBUDDY_CONFIG__`
 * @param buildEnv the three `import.meta.env` values, read statically by the
 *                 caller (Vite only substitutes full static references, so this
 *                 module cannot index `import.meta.env` dynamically)
 */
export function resolveRuntimeConfig(
  runtime: unknown,
  buildEnv: Readonly<Record<string, string | undefined>>,
): RuntimeConfigResolution {
  const fromRuntime =
    typeof runtime === "object" && runtime !== null && !Array.isArray(runtime);
  const raw = fromRuntime ? (runtime as Record<string, unknown>) : null;

  const config: RuntimeConfig = { apiUrl: "", supabaseUrl: "", supabaseAnonKey: "" };
  const missing: string[] = [];

  for (const [key, envVar] of CONFIG_KEYS) {
    const value = asString(raw ? raw[key] : buildEnv[envVar]);
    if (value === "") missing.push(envVar);
    else config[key] = value;
  }

  // `apiFetch` composes `${apiUrl}${path}` with paths that start with "/", so a
  // trailing slash would produce "//projects" and a 404 that is annoying to
  // diagnose. Normalising here means a deployer can paste either form.
  config.apiUrl = config.apiUrl.replace(/\/+$/, "");

  return { config, missing, source: fromRuntime ? "runtime" : "build" };
}

function readGlobal(): unknown {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL];
}

const resolution = resolveRuntimeConfig(readGlobal(), {
  // Static references on purpose — Vite replaces `import.meta.env.VITE_FOO`
  // textually and does not support dynamic key access in a production build.
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

export const runtimeConfig: RuntimeConfig = resolution.config;

/**
 * Env-var names the deployment did not supply. `main.tsx` checks this *before*
 * importing the app: `createClient("", "")` throws during module evaluation,
 * which would otherwise be a blank page with one line in the console.
 */
export const missingConfigKeys: readonly string[] = resolution.missing;

export const runtimeConfigSource = resolution.source;
