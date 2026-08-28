import { prisma } from "./prisma.js";
import { addDays, isoDate, weekEnd, weekStart } from "./dates.js";

/**
 * The single payload every AI agent sees. Built once per run so the specialist
 * agents all reason over identical facts (and so the chat agent's tools have a
 * deterministic dataset to query).
 */
export interface UserSnapshot {
  user: { name: string; timezone: string; monthlyIncome: number | null; savingsGoal: number | null };
  period: { weekStart: string; weekEnd: string; label: string };
  expenses: Array<{
    id: string;
    date: string;
    amount: number;
    category: string;
    merchant: string | null;
    description: string | null;
    necessity: string;
    source: string;
  }>;
  activities: Array<{ date: string; category: string; description: string; durationMin: number; productivity: number | null }>;
  workLogs: Array<{ date: string; hours: number; hourlyRate: number | null; notes: string | null }>;
  tasks: Array<{ title: string; status: string; priority: string; dueAt: string | null; completedAt: string | null }>;
  plan: {
    lunchBudget: number;
    dinnerBudget: number;
    otherBudget: number;
    incomeExpected: number;
    goals: unknown;
    plannedTasks: unknown;
  } | null;
  totals: {
    spent: number;
    byCategory: Record<string, number>;
    byDay: Record<string, number>;
    wantSpend: number;
    needSpend: number;
    workHours: number;
    earned: number;
    activityMinutesByCategory: Record<string, number>;
    tasksCompleted: number;
    tasksOpen: number;
    effectiveHourlyRate: number | null;
  };
  accounts: Array<{ name: string; mask: string | null; type: string | null; currentBalance: number | null }>;
  priorWeeks: Array<{ weekStart: string; totalSpent: number; couldHaveSaved: number }>;
}

export async function buildSnapshot(userId: string, reference: Date = new Date()): Promise<UserSnapshot> {
  const start = weekStart(reference);
  const end = weekEnd(reference);

  const [user, expenses, activities, workLogs, tasks, plan, bankItems, priorReviews] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.expense.findMany({ where: { userId, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    prisma.activity.findMany({ where: { userId, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    prisma.workLog.findMany({ where: { userId, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    prisma.task.findMany({ where: { userId, createdAt: { lte: end } }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.weeklyPlan.findUnique({ where: { userId_weekStart: { userId, weekStart: start } } }),
    prisma.bankItem.findMany({ where: { userId }, include: { accounts: true } }),
    prisma.weeklyReview.findMany({ where: { userId, weekStart: { lt: start } }, orderBy: { weekStart: "desc" }, take: 4 }),
  ]);

  const byCategory: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let wantSpend = 0;
  let needSpend = 0;
  let spent = 0;

  for (let i = 0; i < 7; i += 1) byDay[isoDate(addDays(start, i))] = 0;

  for (const e of expenses) {
    spent += e.amount;
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    const day = isoDate(e.date);
    byDay[day] = (byDay[day] ?? 0) + e.amount;
    if (e.necessity === "want") wantSpend += e.amount;
    if (e.necessity === "need") needSpend += e.amount;
  }

  const activityMinutesByCategory: Record<string, number> = {};
  for (const a of activities) {
    activityMinutesByCategory[a.category] = (activityMinutesByCategory[a.category] ?? 0) + a.durationMin;
  }

  const workHours = workLogs.reduce((sum, w) => sum + w.hours, 0);
  const earned = workLogs.reduce((sum, w) => sum + w.hours * (w.hourlyRate ?? 0), 0);

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    user: {
      name: user.name,
      timezone: user.timezone,
      monthlyIncome: user.monthlyIncome,
      savingsGoal: user.savingsGoal,
    },
    period: { weekStart: isoDate(start), weekEnd: isoDate(end), label: `${isoDate(start)} to ${isoDate(end)}` },
    expenses: expenses.map((e) => ({
      id: e.id,
      date: isoDate(e.date),
      amount: e.amount,
      category: e.category,
      merchant: e.merchant,
      description: e.description,
      necessity: e.necessity,
      source: e.source,
    })),
    activities: activities.map((a) => ({
      date: isoDate(a.date),
      category: a.category,
      description: a.description,
      durationMin: a.durationMin,
      productivity: a.productivity,
    })),
    workLogs: workLogs.map((w) => ({
      date: isoDate(w.date),
      hours: w.hours,
      hourlyRate: w.hourlyRate,
      notes: w.notes,
    })),
    tasks: tasks.map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    })),
    plan: plan
      ? {
          lunchBudget: plan.lunchBudget,
          dinnerBudget: plan.dinnerBudget,
          otherBudget: plan.otherBudget,
          incomeExpected: plan.incomeExpected,
          goals: plan.goals,
          plannedTasks: plan.plannedTasks,
        }
      : null,
    totals: {
      spent: round(spent),
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round(v)])),
      byDay: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, round(v)])),
      wantSpend: round(wantSpend),
      needSpend: round(needSpend),
      workHours: round(workHours),
      earned: round(earned),
      activityMinutesByCategory,
      tasksCompleted: tasks.filter((t) => t.status === "done").length,
      tasksOpen: tasks.filter((t) => t.status === "open").length,
      effectiveHourlyRate: workHours > 0 ? round(earned / workHours) : null,
    },
    accounts: bankItems.flatMap((item) =>
      item.accounts.map((a) => ({
        name: `${item.institutionName} ${a.name}`,
        mask: a.mask,
        type: a.type,
        currentBalance: a.currentBalance,
      })),
    ),
    priorWeeks: priorReviews.map((r) => ({
      weekStart: isoDate(r.weekStart),
      totalSpent: r.totalSpent,
      couldHaveSaved: r.couldHaveSaved,
    })),
  };
}
