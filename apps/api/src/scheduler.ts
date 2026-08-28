import cron from "node-cron";
import { prisma } from "./lib/prisma.js";
import { activeUserIds, runWeeklyReview } from "./lib/workflows.js";
import { weekStart } from "./lib/dates.js";
import { syncItem } from "./routes/bank.js";
import { env } from "./lib/env.js";

/**
 * In-process schedule (UTC):
 *   Fri 22:00 — run the multi-agent weekly review for everyone who logged data.
 *   Mon 12:00 — open the Monday intake by clearing last week's "planned" flag.
 *   Daily 06:00 — pull fresh bank transactions.
 *
 * The same work is exposed at /api/cron/* so Render Cron Jobs can drive it
 * instead when the web service is allowed to sleep.
 */

export async function fridayReviewJob(): Promise<{ ran: number; failed: number }> {
  const ids = await activeUserIds();
  let ran = 0;
  let failed = 0;
  for (const userId of ids) {
    try {
      await runWeeklyReview(userId);
      ran += 1;
    } catch (err) {
      failed += 1;
      console.error(`[cron] weekly review failed for ${userId}:`, (err as Error).message);
    }
  }
  return { ran, failed };
}

export async function mondayPromptJob(): Promise<{ pending: number }> {
  const start = weekStart(new Date());
  const users = await prisma.user.findMany({ select: { id: true } });
  let pending = 0;
  for (const user of users) {
    const plan = await prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart: start } },
    });
    if (!plan) pending += 1;
  }
  return { pending };
}

export async function bankSyncJob(): Promise<{ synced: number; imported: number }> {
  const items = await prisma.bankItem.findMany({ select: { id: true } });
  let imported = 0;
  let synced = 0;
  for (const item of items) {
    try {
      imported += (await syncItem(item.id)).imported;
      synced += 1;
    } catch (err) {
      console.error(`[cron] bank sync failed for item ${item.id}:`, (err as Error).message);
    }
  }
  return { synced, imported };
}

export function startScheduler(): void {
  if (!env.enableScheduler) {
    console.log("[cron] scheduler disabled (ENABLE_SCHEDULER=false)");
    return;
  }
  cron.schedule("0 22 * * 5", () => {
    void fridayReviewJob().then((r) => console.log("[cron] friday review", r));
  }, { timezone: "UTC" });

  cron.schedule("0 12 * * 1", () => {
    void mondayPromptJob().then((r) => console.log("[cron] monday intake pending", r));
  }, { timezone: "UTC" });

  cron.schedule("0 6 * * *", () => {
    void bankSyncJob().then((r) => console.log("[cron] bank sync", r));
  }, { timezone: "UTC" });

  console.log("[cron] scheduler started (Fri 22:00, Mon 12:00, daily 06:00 UTC)");
}
