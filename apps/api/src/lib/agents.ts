import { env } from "./env.js";
import type { UserSnapshot } from "./snapshot.js";

const headers = {
  "content-type": "application/json",
  "x-agents-secret": env.agentsSharedSecret,
};

async function post<T>(path: string, body: unknown, timeoutMs = 300_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.agentsUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Agent service ${path} failed (${res.status}): ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface WeeklyReviewResult {
  breakdown: Record<string, unknown>;
  agent_reports: Record<string, unknown>;
  narrative: string;
  wasted_spend: number;
  could_have_saved: number;
  next_week_plan: Record<string, unknown>;
}

export interface MondayPlanResult {
  budget_advice: Record<string, unknown>;
  game_plan: Record<string, unknown>;
  meals: Array<{
    day_of_week: number;
    meal: string;
    name: string;
    calories: number;
    est_cost: number;
    ingredients: string[];
    steps: string;
    save_vs_eat_out: number;
  }>;
  calorie_savings_total: number;
  notes: string;
}

export const agentService = {
  health: async (): Promise<{ ok: boolean; detail?: string }> => {
    try {
      const res = await fetch(`${env.agentsUrl}/health`, { headers });
      return { ok: res.ok };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  },

  weeklyReview: (snapshot: UserSnapshot) => post<WeeklyReviewResult>("/agents/weekly-review", { snapshot }),

  mondayPlan: (snapshot: UserSnapshot, intake: Record<string, unknown>) =>
    post<MondayPlanResult>("/agents/monday-plan", { snapshot, intake }),

  quickInsight: (snapshot: UserSnapshot) => post<{ insight: string }>("/agents/quick-insight", { snapshot }, 120_000),

  /** Returns the raw upstream response so the route can pipe SSE straight through. */
  chatStream: (payload: {
    snapshot: UserSnapshot;
    messages: Array<{ role: string; content: string }>;
  }): Promise<Response> =>
    fetch(`${env.agentsUrl}/agents/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
};
