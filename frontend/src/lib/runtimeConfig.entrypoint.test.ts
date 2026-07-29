/**
 * Executes the real container-startup script
 * (`frontend/docker-entrypoint.d/10-onboardbuddy-runtime-config.sh`) against a
 * temporary directory and checks what it actually writes.
 *
 * This is the half of issue #73 that lives outside TypeScript: the app can only
 * read a runtime configuration if something writes one, and the same script is
 * what stops the Content-Security-Policy hardcoding `localhost:3000`. A unit
 * test of the resolver alone would pass while the deployment stayed broken.
 *
 * The generated `config.js` is evaluated in a sandbox rather than pattern
 * matched, because "is it valid JavaScript that assigns the expected object" is
 * the property that matters — including for the hostile values below, which are
 * what a config-generating shell script gets wrong.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createContext, runInContext } from "node:vm";

// vitest's root is the frontend workspace (see markdownRenderers.guard.test.ts).
const ROOT = process.cwd();
const SCRIPT = join(ROOT, "docker-entrypoint.d", "10-onboardbuddy-runtime-config.sh");
const TEMPLATE = join(ROOT, "security-headers.conf.template");

type Run = { config: Record<string, unknown> | undefined; configJs: string; headers: string; log: string };

function run(env: Record<string, string>): Run {
  const dir = mkdtempSync(join(tmpdir(), "ob-runtime-config-"));
  const html = join(dir, "html");
  mkdirSync(html);
  const headersOut = join(dir, "security-headers.conf");

  const proc = spawnSync("sh", [SCRIPT], {
    // A deliberately minimal environment: it proves the script needs nothing
    // beyond the three variables, and stops a stray VITE_* on the developer's
    // machine from making a test pass that would fail in a container.
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      ONBOARDBUDDY_HTML_DIR: html,
      ONBOARDBUDDY_HEADERS_TEMPLATE: TEMPLATE,
      ONBOARDBUDDY_HEADERS_OUT: headersOut,
      ...env,
    },
    encoding: "utf8",
  });
  expect(proc.status, `script exited ${proc.status}: ${proc.stderr}`).toBe(0);
  const log = `${proc.stdout}${proc.stderr}`;

  const configJs = readFileSync(join(html, "config.js"), "utf8");
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  createContext(sandbox);
  runInContext(configJs, sandbox);

  return {
    config: sandbox.window.__ONBOARDBUDDY_CONFIG__ as Record<string, unknown> | undefined,
    configJs,
    headers: readFileSync(headersOut, "utf8"),
    log,
  };
}

/** The `add_header` lines only — the template's comments are prose, not policy. */
function directives(headers: string): string[] {
  return headers.split("\n").filter((line) => line.trimStart().startsWith("add_header"));
}

function connectSrc(headers: string): string {
  const csp = headers.match(/Content-Security-Policy\s+"([^"]+)"/)?.[1] ?? "";
  return csp.match(/connect-src ([^;]+)/)?.[1]?.trim() ?? "";
}

const COMPOSE = {
  VITE_API_URL: "http://localhost:3000/api",
  VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_AbCd-123_xyz",
};

const RAILWAY = {
  VITE_API_URL: "https://onboardbuddy-api.up.railway.app/api",
  VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_AbCd-123_xyz",
};

describe("the container startup script writes a usable config.js", () => {
  it("publishes the compose values", () => {
    expect(run(COMPOSE).config).toEqual({
      apiUrl: "http://localhost:3000/api",
      supabaseUrl: "https://abcdefgh.supabase.co",
      supabaseAnonKey: "sb_publishable_AbCd-123_xyz",
    });
  });

  it("publishes a different API origin from the same script — the point of #73", () => {
    expect(run(RAILWAY).config?.apiUrl).toBe("https://onboardbuddy-api.up.railway.app/api");
  });

  it("publishes only the three allow-listed keys, never the wider environment", () => {
    const { config, configJs } = run({
      ...COMPOSE,
      VITE_SECRET_SOMETHING: "sb_secret_should_never_ship",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_service_role",
      DATABASE_URL: "postgres://user:pw@host/db",
    });
    expect(Object.keys(config ?? {}).sort()).toEqual(["apiUrl", "supabaseAnonKey", "supabaseUrl"]);
    expect(configJs).not.toContain("sb_secret");
    expect(configJs).not.toContain("postgres://");
  });

  it("emits an empty value, not a broken file, when a variable is unset", () => {
    const { config, log } = run({ VITE_SUPABASE_URL: COMPOSE.VITE_SUPABASE_URL });
    // Empty (not absent) is deliberate: the app treats the runtime object as
    // authoritative, so an empty key means "missing" and produces the
    // configuration-error page rather than a fallback to a baked value.
    expect(config).toEqual({
      apiUrl: "",
      supabaseUrl: "https://abcdefgh.supabase.co",
      supabaseAnonKey: "",
    });
    expect(log).toContain("MISSING VITE_API_URL");
    expect(log).toContain("MISSING VITE_SUPABASE_ANON_KEY");
  });

  it("rejects values that are not a URL or a key, and says so without echoing them", () => {
    const hostile = {
      VITE_API_URL: 'https://evil.example.com"; window.stolen = document.cookie; //',
      VITE_SUPABASE_URL: "javascript:alert(1)",
      VITE_SUPABASE_ANON_KEY: "</script><script>alert(1)</script>",
    };
    const { config, configJs, log } = run(hostile);
    expect(config).toEqual({ apiUrl: "", supabaseUrl: "", supabaseAnonKey: "" });
    expect(configJs).not.toContain("window.stolen");
    expect(configJs).not.toContain("alert(1)");
    for (const value of Object.values(hostile)) expect(log).not.toContain(value);
    expect(log).toContain("INVALID VITE_API_URL");
  });

  it("rejects a multi-line value rather than matching only its first line", () => {
    const { config } = run({ ...COMPOSE, VITE_API_URL: "https://ok.example.com\nwindow.x=1" });
    expect(config?.apiUrl).toBe("");
  });
});

describe("the same script derives the CSP connect-src from those values", () => {
  it("renders the compose topology and no longer hardcodes anything", () => {
    const { headers } = run(COMPOSE);
    expect(connectSrc(headers)).toBe(
      "'self' http://localhost:3000 https://abcdefgh.supabase.co wss://abcdefgh.supabase.co",
    );
    // The placeholder survives in the template's commentary on purpose — that
    // comment is the only explanation an operator reading the rendered file
    // inside a container gets. It must not survive in a directive.
    expect(directives(headers).join("\n")).not.toContain("__CSP_CONNECT_SRC__");
  });

  it("renders the Railway API domain instead, with no localhost anywhere", () => {
    const { headers } = run(RAILWAY);
    expect(connectSrc(headers)).toBe(
      "'self' https://onboardbuddy-api.up.railway.app https://abcdefgh.supabase.co wss://abcdefgh.supabase.co",
    );
    expect(headers).not.toContain("localhost");
  });

  it("names one Supabase project rather than the `*.supabase.co` wildcard it replaced", () => {
    expect(connectSrc(run(COMPOSE).headers)).not.toContain("*");
  });

  it("drops the API source entirely when the API is same-origin", () => {
    // A reverse-proxied deployment (VITE_API_URL=/api) needs no extra source:
    // 'self' already covers it, and the policy should not claim more.
    const { headers } = run({ ...COMPOSE, VITE_API_URL: "/api" });
    expect(connectSrc(headers)).toBe(
      "'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co",
    );
  });

  it("falls back to `'self'` alone when nothing is configured", () => {
    // The unconfigured image state. Strictest possible policy; the app shows
    // its configuration-error page, which needs no network at all.
    expect(connectSrc(run({}).headers)).toBe("'self'");
  });

  it("does not repeat a source when the API and Supabase share an origin", () => {
    const shared = {
      ...COMPOSE,
      VITE_API_URL: "https://abcdefgh.supabase.co/api",
    };
    expect(connectSrc(run(shared).headers)).toBe(
      "'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co",
    );
  });

  it("changes connect-src and nothing else — every other header survives rendering", () => {
    const normalise = (s: string) =>
      directives(s).map((line) => line.replace(/connect-src [^;]+;/, "connect-src X;"));
    expect(normalise(run(COMPOSE).headers)).toEqual(normalise(readFileSync(TEMPLATE, "utf8")));
  });
});

describe("the app and the script agree on the contract", () => {
  it("index.html loads /config.js synchronously, before the app module", () => {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const configAt = html.indexOf('<script src="/config.js"></script>');
    const moduleAt = html.indexOf('<script type="module"');
    expect(configAt, "/config.js must be loaded by index.html").toBeGreaterThan(-1);
    expect(configAt).toBeLessThan(moduleAt);
  });

  it("the committed public/config.js defines nothing, so local dev keeps using .env", () => {
    const placeholder = readFileSync(join(ROOT, "public", "config.js"), "utf8");
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    createContext(sandbox);
    runInContext(placeholder, sandbox);
    expect(sandbox.window.__ONBOARDBUDDY_CONFIG__).toBeUndefined();
  });

  it("nginx serves /config.js no-store — a cached copy would outlive its deployment", () => {
    const nginx = readFileSync(join(ROOT, "nginx.conf"), "utf8");
    const block = nginx.split("location = /config.js")[1]?.split("}")[0] ?? "";
    expect(block).toContain('add_header Cache-Control "no-store"');
  });

  it("no source file reads VITE_* directly any more — runtimeConfig.ts is the only door", () => {
    // The regression this catches: someone adds `import.meta.env.VITE_API_URL`
    // to a new component. It works locally, builds clean, and silently ships an
    // image pinned to whatever was in .env at build time — the original bug.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          if (/import\.meta\.env\.VITE_/.test(text) && !full.endsWith("runtimeConfig.ts")) {
            offenders.push(relative(ROOT, full));
          }
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(
      offenders,
      "read runtimeConfig instead — a VITE_ reference is inlined at build time",
    ).toEqual([]);
  });
});
