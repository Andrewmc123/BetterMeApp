import { prisma } from "./prisma.js";
import { agentService } from "./agents.js";
import { buildSnapshot } from "./snapshot.js";
import { addDays, weekEnd, weekStart } from "./dates.js";
import type { Prisma } from "@prisma/client";

/**
 * The two scheduled workflows.
 *
 *   Friday  -> runWeeklyReview: multi-agent post-mortem of the week that just happened.
 *   Monday  -> runMondayPlan:   turns the user's intake into a budget, game plan and meal set.
 *
 * Both are also callable on demand from the UI, so the user is never stuck
 * waiting for a specific day of the week.
 */

const asJson = (value: unknown): Prisma.InputJsonValue => (value ?? {}) as Prisma.InputJsonValue;

export async function runWeeklyReview(userId: string, reference: Date = new Date()) {
  const start = weekStart(reference);
  const end = weekEnd(reference);
  const snapshot = await buildSnapshot(userId, reference);

  if (snapshot.expenses.length === 0 && snapshot.activities.length === 0) {
    throw new Error("Nothing logged for this week yet — add some expenses or activities first.");
  }

  const result = await agentService.weeklyReview(snapshot);

  return prisma.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart: start } },
    create: {
      userId,
      weekStart: start,
      weekEnd: end,
      totalSpent: snapshot.totals.spent,
      totalHours: snapshot.totals.workHours,
      breakdown: asJson({ ...result.breakdown, totals: snapshot.totals }),
      agentReports: asJson(result.agent_reports),
      narrative: result.narrative,
      wastedSpend: result.wasted_spend,
      couldHaveSaved: result.could_have_saved,
      nextWeekPlan: asJson(result.next_week_plan),
      status: "complete",
    },
    update: {
      weekEnd: end,
      totalSpent: snapshot.totals.spent,
      totalHours: snapshot.totals.workHours,
      breakdown: asJson({ ...result.breakdown, totals: snapshot.totals }),
      agentReports: asJson(result.agent_reports),
      narrative: result.narrative,
      wastedSpend: result.wasted_spend,
      couldHaveSaved: result.could_have_saved,
      nextWeekPlan: asJson(result.next_week_plan),
      status: "complete",
    },
  });
}

export interface MondayIntake {
  lunchBudget: number;
  dinnerBudget: number;
  otherBudget: number;
  incomeExpected: number;
  goals: string[];
  plannedTasks: Array<{ title: string; dueAt?: string | null; priority?: "low" | "medium" | "high" }>;
  calorieTarget?: number;
  dietNotes?: string;
}

export async function runMondayPlan(userId: string, intake: MondayIntake, reference: Date = new Date()) {
  const start = weekStart(reference);
  const snapshot = await buildSnapshot(userId, reference);

  const plan = await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart: start } },
    create: {
      userId,
      weekStart: start,
      lunchBudget: intake.lunchBudget,
      dinnerBudget: intake.dinnerBudget,
      otherBudget: intake.otherBudget,
      incomeExpected: intake.incomeExpected,
      goals: asJson(intake.goals),
      plannedTasks: asJson(intake.plannedTasks),
    },
    update: {
      lunchBudget: intake.lunchBudget,
      dinnerBudget: intake.dinnerBudget,
      otherBudget: intake.otherBudget,
      incomeExpected: intake.incomeExpected,
      goals: asJson(intake.goals),
      plannedTasks: asJson(intake.plannedTasks),
    },
  });

  // Materialise the week's planned tasks so the reminder bar picks them up.
  for (const task of intake.plannedTasks ?? []) {
    if (!task.title?.trim()) continue;
    const exists = await prisma.task.findFirst({
      where: { userId, title: task.title, createdAt: { gte: start } },
    });
    if (exists) continue;
    await prisma.task.create({
      data: {
        userId,
        title: task.title,
        priority: task.priority ?? "medium",
        dueAt: task.dueAt ? new Date(task.dueAt) : null,
      },
    });
  }

  const result = await agentService.mondayPlan({ ...snapshot, plan: {
    lunchBudget: intake.lunchBudget,
    dinnerBudget: intake.dinnerBudget,
    otherBudget: intake.otherBudget,
    incomeExpected: intake.incomeExpected,
    goals: intake.goals,
    plannedTasks: intake.plannedTasks,
  } }, {
    calorie_target: intake.calorieTarget ?? 2000,
    diet_notes: intake.dietNotes ?? "",
  });

  await prisma.mealSuggestion.deleteMany({ where: { userId, weekStart: start } });
  if (result.meals?.length) {
    await prisma.mealSuggestion.createMany({
      data: result.meals.map((m) => ({
        userId,
        weekStart: start,
        dayOfWeek: m.day_of_week,
        meal: m.meal,
        name: m.name,
        calories: m.calories,
        estCost: m.est_cost,
        ingredients: asJson(m.ingredients),
        steps: m.steps,
        saveVsEatOut: m.save_vs_eat_out,
      })),
    });
  }

  const updated = await prisma.weeklyPlan.update({
    where: { id: plan.id },
    data: {
      gamePlan: asJson(result.game_plan),
      aiBudgetAdvice: asJson({ ...result.budget_advice, calorie_savings_total: result.calorie_savings_total, notes: result.notes }),
    },
  });

  const meals = await prisma.mealSuggestion.findMany({
    where: { userId, weekStart: start },
    orderBy: [{ dayOfWeek: "asc" }, { meal: "asc" }],
  });

  return { plan: updated, meals, calorieSavingsTotal: result.calorie_savings_total, notes: result.notes };
}

/** Users who logged anything in the current week — the scheduler's audience. */
export async function activeUserIds(reference: Date = new Date()): Promise<string[]> {
  const start = weekStart(reference);
  const end = addDays(start, 7);
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { expenses: { some: { date: { gte: start, lt: end } } } },
        { activities: { some: { date: { gte: start, lt: end } } } },
        { workLogs: { some: { date: { gte: start, lt: end } } } },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
