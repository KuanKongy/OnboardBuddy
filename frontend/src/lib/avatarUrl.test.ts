/**
 * Avatar-URL allowlist (doc/SECURITY_XSS_PROMPT_INJECTION.md finding X2).
 *
 * The confirmed behaviour was that setting an avatar URL to an attacker host
 * made the browser issue a real GET on every page load — a beacon. Hostnames
 * here use RFC 2606 reserved domains so nothing can reach a live host.
 */

import { describe, expect, it } from "vitest";
import { isSafeAvatarUrl, safeAvatarSrc } from "./avatarUrl";

describe("isSafeAvatarUrl", () => {
  it("accepts the hosts that legitimately serve avatars for this app", () => {
    for (const url of [
      "https://avatars.githubusercontent.com/u/1?v=4",
      "https://raw.githubusercontent.com/o/r/main/a.png",
      "https://www.gravatar.com/avatar/abc",
      "https://xyz.supabase.co/storage/v1/object/public/avatars/a.png",
    ]) {
      expect(isSafeAvatarUrl(url), url).toBe(true);
    }
  });

  it("rejects the beacon that was confirmed live", () => {
    expect(isSafeAvatarUrl("https://obb-avatar-beacon.invalid/track.png?leak=session")).toBe(false);
  });

  it("rejects lookalike hosts that a naive suffix check would accept", () => {
    for (const url of [
      "https://githubusercontent.com.evil.example/a.png",
      "https://evil.example/githubusercontent.com/a.png",
      "https://notgithubusercontent.com/a.png",
      "https://gravatar.com.attacker.example/a.png",
    ]) {
      expect(isSafeAvatarUrl(url), url).toBe(false);
    }
  });

  it("requires https", () => {
    expect(isSafeAvatarUrl("http://avatars.githubusercontent.com/u/1")).toBe(false);
    expect(isSafeAvatarUrl("//avatars.githubusercontent.com/u/1")).toBe(false);
  });

  it("rejects script and data schemes", () => {
    for (const url of [
      "javascript:window.__pwn=1",
      "data:image/svg+xml,<svg onload='window.__pwn=1'/>",
      "file:///etc/passwd",
    ]) {
      expect(isSafeAvatarUrl(url), url).toBe(false);
    }
  });

  it("rejects empty and unparseable values", () => {
    for (const url of ["", "   ", "not a url", null, undefined]) {
      expect(isSafeAvatarUrl(url as string), String(url)).toBe(false);
    }
  });
});

describe("safeAvatarSrc", () => {
  it("returns undefined for an unsafe URL so no <img src> is rendered at all", () => {
    // `undefined` and not `""`: an empty src still resolves against the page
    // URL and issues a request in some browsers.
    expect(safeAvatarSrc("https://beacon.invalid/track.png")).toBeUndefined();
    expect(safeAvatarSrc("")).toBeUndefined();
  });

  it("passes a safe URL through, trimmed", () => {
    expect(safeAvatarSrc("  https://avatars.githubusercontent.com/u/1  ")).toBe(
      "https://avatars.githubusercontent.com/u/1",
    );
  });
});
