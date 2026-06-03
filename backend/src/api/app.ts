import cors from "cors";
import express from "express";
import { apiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
      credentials: true
    }),
  );
  app.use(express.json());

  app.use("/api", apiRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: "Not Found"
    });
  });

  return app;
}
