import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { endOfDay, startOfDay, weekEnd, weekStart } from "../lib/dates.js";

export const logRouter = Router();
logRouter.use(requireAuth);

const EXPENSE_CATEGORIES = [
  "food_out",
  "groceries",
  "transport",
  "rent",
  "bills",
  "subscriptions",
  "shopping",
  "fun",
  "health",
  "other",
] as const;

const ACTIVITY_CATEGORIES = [
  "work",
  "health",
  "social",
  "learning",
  "chores",
  "leisure",
  "commute",
  "other",
] as const;

/** Range helper: ?date=YYYY-MM-DD for one day, or ?week=YYYY-MM-DD for that week. */
function rangeFrom(query: Record<string, unknown>): { gte: Date; lte: Date } {
  if (typeof query.date === "string") {
    return { gte: startOfDay(query.date), lte: endOfDay(query.date) };
  }
  const reference = typeof query.week === "string" ? new Date(query.week) : new Date();
  return { gte: weekStart(reference), lte: weekEnd(reference) };
}

/* ---------------------------------------------------------------- expenses */

logRouter.get("/expenses", async (req: AuthedRequest, res) => {
  const expenses = await prisma.expense.findMany({
    where: { userId: req.userId!, date: rangeFrom(req.query as Record<string, unknown>) },
    orderBy: { date: "desc" },
  });
  res.json({ expenses });
});

logRouter.post("/expenses", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      date: z.string(),
      amount: z.number().positive(),
      category: z.enum(EXPENSE_CATEGORIES),
      merchant: z.string().optional(),
      description: z.string().optional(),
      necessity: z.enum(["need", "want", "unknown"]).default("unknown"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const expense = await prisma.expense.create({
    data: { ...parsed.data, date: startOfDay(parsed.data.date), userId: req.userId! },
  });
  res.status(201).json({ expense });
});

logRouter.delete("/expenses/:id", async (req: AuthedRequest, res) => {
  await prisma.expense.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).end();
});

/* -------------------------------------------------------------- activities */

logRouter.get("/activities", async (req: AuthedRequest, res) => {
  const activities = await prisma.activity.findMany({
    where: { userId: req.userId!, date: rangeFrom(req.query as Record<string, unknown>) },
    orderBy: { date: "desc" },
  });
  res.json({ activities });
});

logRouter.post("/activities", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      date: z.string(),
      category: z.enum(ACTIVITY_CATEGORIES),
      description: z.string().min(1),
      durationMin: z.number().int().positive(),
      productivity: z.number().int().min(1).max(5).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const activity = await prisma.activity.create({
    data: { ...parsed.data, date: startOfDay(parsed.data.date), userId: req.userId! },
  });
  res.status(201).json({ activity });
});

logRouter.delete("/activities/:id", async (req: AuthedRequest, res) => {
  await prisma.activity.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).end();
});

/* ---------------------------------------------------------------- worklogs */

logRouter.get("/worklogs", async (req: AuthedRequest, res) => {
  const workLogs = await prisma.workLog.findMany({
    where: { userId: req.userId!, date: rangeFrom(req.query as Record<string, unknown>) },
    orderBy: { date: "desc" },
  });
  res.json({ workLogs });
});

logRouter.post("/worklogs", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      date: z.string(),
      hours: z.number().positive().max(24),
      hourlyRate: z.number().nonnegative().optional(),
      notes: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const workLog = await prisma.workLog.create({
    data: { ...parsed.data, date: startOfDay(parsed.data.date), userId: req.userId! },
  });
  res.status(201).json({ workLog });
});

logRouter.delete("/worklogs/:id", async (req: AuthedRequest, res) => {
  await prisma.workLog.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
  res.status(204).end();
});

/* ---------------------------------------------------------------- check-in */

logRouter.get("/checkin", async (req: AuthedRequest, res) => {
  const date = startOfDay(typeof req.query.date === "string" ? req.query.date : new Date());
  const checkin = await prisma.dailyCheckin.findUnique({
    where: { userId_date: { userId: req.userId!, date } },
  });
  res.json({ checkin });
});

logRouter.post("/checkin", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      date: z.string(),
      completed: z.boolean().default(true),
      mood: z.number().int().min(1).max(5).optional(),
      notes: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const date = startOfDay(parsed.data.date);
  const { date: _ignored, ...rest } = parsed.data;
  const checkin = await prisma.dailyCheckin.upsert({
    where: { userId_date: { userId: req.userId!, date } },
    create: { ...rest, date, userId: req.userId! },
    update: rest,
  });
  res.json({ checkin });
});
