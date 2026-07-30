import compression from "compression";
import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { apiRouter } from "./routes/index.js";
import { githubWebhookRouter } from "./routes/githubWebhook.js";

const DEV_ORIGIN = "http://localhost:5173";

/**
 * Which origins the browser may call this API from (bug #15).
 *
 * The old expression was `process.env.CORS_ORIGIN ?? "http://localhost:5173"`,
 * which is the wrong shape for a deployed service in both directions: a
 * missing variable silently allowed a localhost page to talk to production
 * while blocking the real frontend, and the failure showed up as a CORS error
 * in someone's browser console rather than as a deployment problem. Now the
 * variable is *required* in production — the process refuses to start with a
 * message naming what to set — and only a development run falls back, out
 * loud.
 *
 * Comma-separated values are accepted so a deployment can serve its platform
 * domain and a custom domain at once without a second variable.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (origins.length > 0) return origins;

  if (env.NODE_ENV === "production") {
    throw new Error(
      "CORS_ORIGIN is required in production: set it to the frontend origin " +
        '(e.g. CORS_ORIGIN="https://onboardbuddy.example.com", or a comma-separated list). ' +
        "Refusing to start with a localhost default, which would block the real frontend " +
        "and allow a local page to call this API.",
    );
  }

  if (env.NODE_ENV !== "test") {
    console.warn(`[app] CORS_ORIGIN is not set — allowing ${DEV_ORIGIN} only (development default).`);
  }
  return [DEV_ORIGIN];
}

export function createApp() {
  const app = express();

  // No cookie-based auth flow exists anywhere in this API (verified:
  // no `cookie` usage under src/api) — auth is a Bearer JWT in a header, so
  // `credentials: true` was dead weight a cross-site page cannot exploit.
  app.use(
    cors({
      origin: resolveCorsOrigins(),
    }),
  );
  // GitHub webhook needs the RAW request bytes for HMAC signature
  // verification, so it mounts with its own parser before express.json()
  // (which never sees this path). Auth = the signature, not a bearer token.
  app.use("/api/webhooks/github", express.raw({ type: "*/*", limit: "2mb" }), githubWebhookRouter);
  // After the webhook so the HMAC path keeps its raw parser, before express.json
  // so every route below is covered.
  app.use(compression());
  app.use(express.json());

  app.use("/api", apiRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: "Not Found"
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[app] Unhandled error:", err.message, err.stack);
    if (!res.headersSent) {
      // Framework-thrown client errors (e.g. body-parser's 413 on an
      // oversized request) carry a real HTTP status; forward it instead of
      // always answering 500, which masks a client mistake as a server
      // failure. Narrowed to 400-499 so an unrelated error with an
      // unexpected `.status`/`.statusCode` field can never spoof a status.
      const candidate = (err as { status?: unknown; statusCode?: unknown }).status ??
        (err as { status?: unknown; statusCode?: unknown }).statusCode;
      const status = typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate < 500
        ? candidate
        : 500;
      res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
    }
  });

  return app;
}
