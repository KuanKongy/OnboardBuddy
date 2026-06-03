import { Router } from "express";
import { getHealthStatus } from "../services/health.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json(getHealthStatus());
});
