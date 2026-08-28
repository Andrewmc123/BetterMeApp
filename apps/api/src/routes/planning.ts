import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { weekStart } from "../lib/dates.js";
import { runMondayPlan, runWeeklyReview } from "../lib/workflows.js";
import { buildSnapshot } from "../lib/snapshot.js";
import { agentService } from "../lib/agents.js";

export const planningRouter = Router();
planningRouter.use(requireAuth);

const reference = (req: AuthedRequest) =>
  typeof req.query.week === "string" ? new Date(req.query.week) : new Date();

/* ------------------------------------------------- Monday: plan the week */

planningRouter.get("/plan", async (req: AuthedRequest, res) => {
  const start = weekStart(reference(req));
  const [plan, meals] = await Promise.all([
    prisma.weeklyPlan.findUnique({ where: { userId_weekStart: { userId: req.userId!, weekStart: start } } }),
    prisma.mealSuggestion.findMany({
      where: { userId: req.userId!, weekStart: start },
      orderBy: [{ dayOfWeek: "asc" }, { meal: "asc" }],
    }),
  ]);
  res.json({ plan, meals, weekStart: start.toISOString().slice(0, 10) });
});

planningRouter.post("/plan", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      lunchBudget: z.number().nonnegative().default(0),
      dinnerBudget: z.number().nonnegative().default(0),
      otherBudget: z.number().nonnegative().default(0),
      incomeExpected: z.number().nonnegative().default(0),
      goals: z.array(z.string()).default([]),
      plannedTasks: z
        .array(
          z.object({
            title: z.string().min(1),
            dueAt: z.string().datetime().nullable().optional(),
            priority: z.enum(["low", "medium", "high"]).optional(),
          }),
        )
        .default([]),
      calorieTarget: z.number().int().positive().optional(),
      dietNotes: z.string().optional(),
      week: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  try {
    const { week, ...intake } = parsed.data;
    const result = await runMondayPlan(req.userId!, intake, week ? new Date(week) : new Date());
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/* ------------------------------------------- Friday: review the week past */

planningRouter.get("/review", async (req: AuthedRequest, res) => {
  const start = weekStart(reference(req));
  const review = await prisma.weeklyReview.findUnique({
    where: { userId_weekStart: { userId: req.userId!, weekStart: start } },
  });
  res.json({ review });
});

planningRouter.get("/reviews", async (req: AuthedRequest, res) => {
  const reviews = await prisma.weeklyReview.findMany({
    where: { userId: req.userId! },
    orderBy: { weekStart: "desc" },
    take: 26,
  });
  res.json({ reviews });
});

planningRouter.post("/review/run", async (req: AuthedRequest, res) => {
  try {
    const week = typeof req.body?.week === "string" ? new Date(req.body.week) : new Date();
    const review = await runWeeklyReview(req.userId!, week);
    res.json({ review });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/* -------------------------------------------------------------- insights */

planningRouter.get("/insight", async (req: AuthedRequest, res) => {
  try {
    const snapshot = await buildSnapshot(req.userId!, reference(req));
    const { insight } = await agentService.quickInsight(snapshot);
    res.json({ insight });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, insight: null });
  }
});

planningRouter.get("/snapshot", async (req: AuthedRequest, res) => {
  res.json({ snapshot: await buildSnapshot(req.userId!, reference(req)) });
});
