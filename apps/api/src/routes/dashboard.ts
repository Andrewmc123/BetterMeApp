import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { buildSnapshot } from "../lib/snapshot.js";
import { isoDate, startOfDay, weekStart } from "../lib/dates.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const today = startOfDay(new Date());
  const start = weekStart(new Date());
  const now = new Date();

  const [snapshot, checkin, plan, review, openTasks, overdue] = await Promise.all([
    buildSnapshot(userId),
    prisma.dailyCheckin.findUnique({ where: { userId_date: { userId, date: today } } }),
    prisma.weeklyPlan.findUnique({ where: { userId_weekStart: { userId, weekStart: start } } }),
    prisma.weeklyReview.findUnique({ where: { userId_weekStart: { userId, weekStart: start } } }),
    prisma.task.count({ where: { userId, status: "open" } }),
    prisma.task.count({ where: { userId, status: "open", dueAt: { lt: now } } }),
  ]);

  const daysElapsed = Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1);
  const weeklyBudget = plan ? (plan.lunchBudget + plan.dinnerBudget) * 7 + plan.otherBudget : null;
  const spentToday = snapshot.totals.byDay[isoDate(today)] ?? 0;

  res.json({
    today: isoDate(today),
    weekStart: isoDate(start),
    checkinDone: checkin?.completed ?? false,
    totals: snapshot.totals,
    spentToday,
    pace: {
      daysElapsed,
      weeklyBudget,
      budgetRemaining: weeklyBudget === null ? null : Math.round((weeklyBudget - snapshot.totals.spent) * 100) / 100,
      dailyAllowanceLeft:
        weeklyBudget === null
          ? null
          : Math.round(((weeklyBudget - snapshot.totals.spent) / Math.max(1, 8 - daysElapsed)) * 100) / 100,
      onTrack: weeklyBudget === null ? null : snapshot.totals.spent <= (weeklyBudget / 7) * daysElapsed,
    },
    tasks: { open: openTasks, overdue },
    hasPlan: Boolean(plan),
    hasReview: Boolean(review),
    topCategories: Object.entries(snapshot.totals.byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, amount]) => ({ category, amount })),
    accounts: snapshot.accounts,
  });
});
