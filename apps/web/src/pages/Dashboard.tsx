import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, money } from "../api";
import { useAuth } from "../auth";

interface DashboardData {
  today: string;
  weekStart: string;
  checkinDone: boolean;
  spentToday: number;
  totals: {
    spent: number;
    byCategory: Record<string, number>;
    byDay: Record<string, number>;
    wantSpend: number;
    needSpend: number;
    workHours: number;
    earned: number;
    tasksCompleted: number;
    tasksOpen: number;
    effectiveHourlyRate: number | null;
  };
  pace: {
    weeklyBudget: number | null;
    budgetRemaining: number | null;
    dailyAllowanceLeft: number | null;
    onTrack: boolean | null;
  };
  tasks: { open: number; overdue: number };
  hasPlan: boolean;
  hasReview: boolean;
  topCategories: Array<{ category: string; amount: number }>;
  accounts: Array<{ name: string; mask: string | null; currentBalance: number | null }>;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/dashboard").then(setData).catch((e) => setError(e.message));
    api
      .get<{ insight: string | null }>("/planning/insight")
      .then((r) => setInsight(r.insight))
      .catch((e) => setInsightError(e.message));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="spinner">Loading your week…</div>;

  const dayData = Object.entries(data.totals.byDay).map(([date, amount], i) => ({
    day: DAY_LABELS[i] ?? date.slice(5),
    amount,
  }));
  const dailyCap = data.pace.weeklyBudget ? data.pace.weeklyBudget / 7 : null;

  return (
    <>
      <h1>Hey {user?.name.split(" ")[0]} — here's your week</h1>
      <p className="muted small" style={{ marginTop: "-.3rem" }}>
        Week of {data.weekStart}
      </p>

      {!data.checkinDone && (
        <div className="banner">
          You haven't logged today yet. <Link to="/log">Tell me what you did and what you spent →</Link>
        </div>
      )}
      {!data.hasPlan && (
        <div className="banner">
          No plan for this week. <Link to="/plan">Set your Monday budget and game plan →</Link>
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: "1rem" }}>
        <Stat label="Spent this week" value={money(data.totals.spent)} tone={data.pace.onTrack === false ? "bad" : undefined} sub={data.pace.weeklyBudget ? `of ${money(data.pace.weeklyBudget)} budget` : "no budget set"} />
        <Stat label="Spent today" value={money(data.spentToday)} sub={dailyCap ? `cap ${money(dailyCap)}/day` : undefined} />
        <Stat
          label="Left to spend"
          value={money(data.pace.budgetRemaining)}
          tone={data.pace.budgetRemaining !== null && data.pace.budgetRemaining < 0 ? "bad" : "good"}
          sub={data.pace.dailyAllowanceLeft !== null ? `${money(data.pace.dailyAllowanceLeft)}/day left` : undefined}
        />
        <Stat
          label="Worked"
          value={`${data.totals.workHours}h`}
          sub={data.totals.effectiveHourlyRate ? `${money(data.totals.effectiveHourlyRate)}/hr effective` : "add your rate"}
        />
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>Coach's read</h3>
        {insight ? (
          <p style={{ margin: 0 }}>{insight}</p>
        ) : insightError ? (
          <p className="muted small" style={{ margin: 0 }}>
            AI service unreachable — {insightError}
          </p>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Thinking…</p>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Spending by day</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dayData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262d3a" vertical={false} />
                <XAxis dataKey="day" stroke="#8b97ad" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#8b97ad" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#1b212c", border: "1px solid #262d3a", borderRadius: 8 }}
                  formatter={(v: number) => money(v)}
                />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {dayData.map((d, i) => (
                    <Cell key={i} fill={dailyCap && d.amount > dailyCap ? "#f87171" : "#4ade80"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3>Where it went</h3>
          {data.topCategories.length === 0 ? (
            <p className="muted small">Nothing logged yet this week.</p>
          ) : (
            <table>
              <tbody>
                {data.topCategories.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category.replace(/_/g, " ")}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(c.amount)}</td>
                    <td style={{ textAlign: "right", width: 60 }} className="muted small">
                      {data.totals.spent ? `${Math.round((c.amount / data.totals.spent) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            Wants {money(data.totals.wantSpend)} · Needs {money(data.totals.needSpend)}
          </p>
        </div>

        <div className="card">
          <h3>Tasks</h3>
          <div className="row">
            <span className="tag">{data.tasks.open} open</span>
            {data.tasks.overdue > 0 && <span className="tag" style={{ color: "#f87171" }}>{data.tasks.overdue} overdue</span>}
            <span className="tag">{data.totals.tasksCompleted} done</span>
          </div>
          <p style={{ marginBottom: 0, marginTop: ".7rem" }}>
            <Link to="/tasks">Open task list →</Link>
          </p>
        </div>

        <div className="card">
          <h3>Accounts</h3>
          {data.accounts.length === 0 ? (
            <p className="muted small">
              No bank connected. <Link to="/bank">Connect one →</Link>
            </p>
          ) : (
            <table>
              <tbody>
                {data.accounts.map((a, i) => (
                  <tr key={i}>
                    <td>
                      {a.name} {a.mask && <span className="muted">····{a.mask}</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(a.currentBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
