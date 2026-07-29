/**
 * Resolution rules for the runtime configuration that replaced the build-time
 * `VITE_*` inlining (issue #73). The precedence here is the whole safety
 * property: a deployed image must never silently fall back to a value baked
 * into the bundle, because that value is `localhost`.
 */

import { describe, expect, it } from "vitest";
import { CONFIG_KEYS, resolveRuntimeConfig } from "./runtimeConfig";

const BUILD_ENV = {
  VITE_API_URL: "http://localhost:3000/api",
  VITE_SUPABASE_URL: "https://build.supabase.co",
  VITE_SUPABASE_ANON_KEY: "build-key",
};

describe("resolveRuntimeConfig", () => {
  it("falls back to build-time env when no runtime global is present", () => {
    const { config, missing, source } = resolveRuntimeConfig(undefined, BUILD_ENV);
    expect(source).toBe("build");
    expect(missing).toEqual([]);
    expect(config).toEqual({
      apiUrl: "http://localhost:3000/api",
      supabaseUrl: "https://build.supabase.co",
      supabaseAnonKey: "build-key",
    });
  });

  it("prefers the runtime global over the baked build-time values", () => {
    const { config, source } = resolveRuntimeConfig(
      {
        apiUrl: "https://onboardbuddy-api.up.railway.app/api",
        supabaseUrl: "https://runtime.supabase.co",
        supabaseAnonKey: "runtime-key",
      },
      BUILD_ENV,
    );
    expect(source).toBe("runtime");
    expect(config.apiUrl).toBe("https://onboardbuddy-api.up.railway.app/api");
    expect(config.supabaseUrl).toBe("https://runtime.supabase.co");
    expect(config.supabaseAnonKey).toBe("runtime-key");
  });

  it("does NOT fall back per key when the runtime global exists but a key is empty", () => {
    // The point of the whole exercise. A partial runtime config that quietly
    // borrowed the baked value would put a deployed app back on localhost —
    // working in staging, wrong in production, with nothing in the logs.
    const { config, missing } = resolveRuntimeConfig(
      { apiUrl: "", supabaseUrl: "https://runtime.supabase.co", supabaseAnonKey: "k" },
      BUILD_ENV,
    );
    expect(config.apiUrl).toBe("");
    expect(missing).toEqual(["VITE_API_URL"]);
  });

  it("reports every missing key by its environment-variable name", () => {
    const { missing } = resolveRuntimeConfig({}, {});
    expect(missing).toEqual([
      "VITE_API_URL",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_ANON_KEY",
    ]);
  });

  it("treats whitespace-only and non-string values as missing", () => {
    const { config, missing } = resolveRuntimeConfig(
      { apiUrl: "   ", supabaseUrl: 42, supabaseAnonKey: null },
      {},
    );
    expect(config).toEqual({ apiUrl: "", supabaseUrl: "", supabaseAnonKey: "" });
    expect(missing).toHaveLength(3);
  });

  it("trims surrounding whitespace, which a .env or a paste often carries", () => {
    const { config } = resolveRuntimeConfig(
      { apiUrl: " https://api.example.com/api ", supabaseUrl: " https://x.supabase.co ", supabaseAnonKey: " k " },
      {},
    );
    expect(config.apiUrl).toBe("https://api.example.com/api");
    expect(config.supabaseUrl).toBe("https://x.supabase.co");
    expect(config.supabaseAnonKey).toBe("k");
  });

  it("strips a trailing slash from the API URL so `${apiUrl}/projects` cannot double up", () => {
    expect(resolveRuntimeConfig({ apiUrl: "https://api.example.com/api/" }, {}).config.apiUrl).toBe(
      "https://api.example.com/api",
    );
    expect(resolveRuntimeConfig({ apiUrl: "/api//" }, {}).config.apiUrl).toBe("/api");
  });

  it("ignores an array or a primitive in the global and falls back to build env", () => {
    for (const bogus of [[], "nope", 7, true]) {
      expect(resolveRuntimeConfig(bogus, BUILD_ENV).source).toBe("build");
    }
    // null is the one falsy object; it must not be treated as a config object.
    expect(resolveRuntimeConfig(null, BUILD_ENV).source).toBe("build");
  });

  it("publishes exactly three keys — the allow-list is the privacy boundary", () => {
    // A prefix scan (`env | grep ^VITE_`) would put any future VITE_-named
    // variable into a world-readable file. Keep this list explicit and short.
    expect(CONFIG_KEYS.map(([, envVar]) => envVar)).toEqual([
      "VITE_API_URL",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_ANON_KEY",
    ]);
  });

  it("ignores unknown keys smuggled into the runtime global", () => {
    const { config } = resolveRuntimeConfig(
      { apiUrl: "/api", serviceRoleKey: "sb_secret_leak", databaseUrl: "postgres://…" },
      {},
    );
    expect(Object.keys(config).sort()).toEqual(["apiUrl", "supabaseAnonKey", "supabaseUrl"]);
    expect(JSON.stringify(config)).not.toContain("sb_secret_leak");
  });
});
