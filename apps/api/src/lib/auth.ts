import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: "30d" });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

/** Guards the cron endpoints that Render Cron Jobs can hit. */
export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers["x-cron-secret"];
  if (provided !== env.cronSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
