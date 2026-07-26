import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { apiRouter } from "./routes/index.js";
import { githubWebhookRouter } from "./routes/githubWebhook.js";

export function createApp() {
  const app = express();

  // No cookie-based auth flow exists anywhere in this API (verified:
  // no `cookie` usage under src/api) — auth is a Bearer JWT in a header, so
  // `credentials: true` was dead weight a cross-site page cannot exploit.
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    }),
  );
  // GitHub webhook needs the RAW request bytes for HMAC signature
  // verification, so it mounts with its own parser before express.json()
  // (which never sees this path). Auth = the signature, not a bearer token.
  app.use("/api/webhooks/github", express.raw({ type: "*/*", limit: "2mb" }), githubWebhookRouter);
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
