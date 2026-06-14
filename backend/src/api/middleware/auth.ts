import type { Request, Response, NextFunction } from "express";
import { verifySupabaseAccessToken } from "../../lib/verifySupabaseJwt.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7);

  try {
    req.user = await verifySupabaseAccessToken(token);
    next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
