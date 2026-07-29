import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCorsOrigins } from "../../src/api/app.js";
import { GitHubAppConfigError, createAppJwt, loadAppPrivateKey } from "../../src/lib/github.js";

/**
 * Missing configuration should read as missing configuration — bugs #3 and
 * #15. Both were reported the same way: something failed at a distance from
 * its cause (a bare 500 on every GitHub route; a CORS error in a browser
 * console) and the message did not name the setting to fix.
 */

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(overrides)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("Bug #3 — GitHub App private key configuration", () => {
  it("names the file, the resolved path and the working directory when the key is missing", () => {
    withEnv(
      { GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_APP_PRIVATE_KEY_PATH: "./github-app.pem" },
      () => {
        // Resolve from a directory that certainly has no key, which is exactly
        // the shape of the reported failure: the path is relative, so the same
        // configuration works or fails depending on the process's cwd.
        const cwd = process.cwd();
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ob-nokey-"));
        process.chdir(empty);
        try {
          let thrown: unknown;
          try {
            loadAppPrivateKey();
          } catch (err) {
            thrown = err;
          }

          expect(thrown).to.be.instanceOf(GitHubAppConfigError);
          const message = (thrown as Error).message;
          expect(message).to.include("GITHUB_APP_PRIVATE_KEY_PATH");
          expect(message).to.include("github-app.pem");
          expect(message).to.include(empty);          // where it looked
          expect(message).to.include("no such file"); // why it failed
        } finally {
          process.chdir(cwd);
          fs.rmSync(empty, { recursive: true, force: true });
        }
      },
    );
  });

  it("explains a directory at the key path — what a docker bind mount leaves behind", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-pemdir-"));
    withEnv({ GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_APP_PRIVATE_KEY_PATH: dir }, () => {
      expect(() => loadAppPrivateKey())
        .to.throw(GitHubAppConfigError)
        .with.property("message")
        .that.includes("directory");
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a file that is not a PEM instead of failing later inside OpenSSL", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ob-badpem-")), "github-app.pem");
    fs.writeFileSync(file, "<!doctype html>\n404 Not Found\n");
    withEnv({ GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_APP_PRIVATE_KEY_PATH: file }, () => {
      expect(() => createAppJwt())
        .to.throw(GitHubAppConfigError)
        .with.property("message")
        .that.includes("PRIVATE KEY");
    });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("says which variable is missing when neither key source is configured", () => {
    withEnv({ GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_APP_PRIVATE_KEY_PATH: undefined }, () => {
      expect(() => loadAppPrivateKey())
        .to.throw(GitHubAppConfigError)
        .with.property("message")
        .that.includes("GITHUB_APP_PRIVATE_KEY");
    });
  });
});

describe("Bug #15 — CORS origin configuration", () => {
  it("refuses to start in production when CORS_ORIGIN is unset, rather than defaulting to localhost", () => {
    withEnv({ NODE_ENV: "production", CORS_ORIGIN: undefined }, () => {
      expect(() => resolveCorsOrigins()).to.throw(/CORS_ORIGIN is required in production/);
    });
    withEnv({ NODE_ENV: "production", CORS_ORIGIN: "   " }, () => {
      expect(() => resolveCorsOrigins()).to.throw(/CORS_ORIGIN is required in production/);
    });
  });

  it("accepts one origin or a comma-separated list, trimmed of trailing slashes", () => {
    withEnv({ NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com/" }, () => {
      expect(resolveCorsOrigins()).to.deep.equal(["https://app.example.com"]);
    });
    withEnv(
      { NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com, https://onboardbuddy.example.com" },
      () => {
        expect(resolveCorsOrigins()).to.deep.equal([
          "https://app.example.com",
          "https://onboardbuddy.example.com",
        ]);
      },
    );
  });

  it("still defaults to the Vite dev server outside production", () => {
    withEnv({ NODE_ENV: "development", CORS_ORIGIN: undefined }, () => {
      expect(resolveCorsOrigins()).to.deep.equal(["http://localhost:5173"]);
    });
  });
});
