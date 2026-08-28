import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, signToken, type AuthedRequest } from "../lib/auth.js";

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

authRouter.post("/register", async (req, res) => {
  const parsed = credentials.extend({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }
  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
    },
  });
  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: publicUser(user) });
});

authRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).optional(),
      timezone: z.string().optional(),
      monthlyIncome: z.number().nonnegative().nullable().optional(),
      savingsGoal: z.number().nonnegative().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const user = await prisma.user.update({ where: { id: req.userId! }, data: parsed.data });
  res.json({ user: publicUser(user) });
});

function publicUser(user: { id: string; email: string; name: string; timezone: string; monthlyIncome: number | null; savingsGoal: number | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    monthlyIncome: user.monthlyIncome,
    savingsGoal: user.savingsGoal,
  };
}
