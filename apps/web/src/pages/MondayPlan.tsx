import { useEffect, useState, type FormEvent } from "react";
import { api, money } from "../api";

interface Meal {
  id: string;
  dayOfWeek: number;
  meal: string;
  name: string;
  calories: number;
  estCost: number;
  ingredients: string[];
  steps: string;
  saveVsEatOut: number;
}

interface DayPlan {
  day: string;
  focus: string;
  spend_cap: number;
  tasks: string[];
  meals: string;
}

interface Plan {
  lunchBudget: number;
  dinnerBudget: number;
  otherBudget: number;
  incomeExpected: number;
  goals: string[];
  gamePlan: {
    theme: string;
    weekly_spend_cap: number;
    daily_lunch_budget: number;
    daily_dinner_budget: number;
    savings_target: number;
    rules: string[];
    days: DayPlan[];
  } | null;
  aiBudgetAdvice: {
    recommended_daily_lunch: number;
    recommended_daily_dinner: number;
    recommended_weekly_other: number;
    weekly_spend_cap: number;
    projected_savings: number;
    reasoning: string;
    warnings: string[];
    calorie_savings_total?: number;
    notes?: string;
  } | null;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The Monday intake: budget, goals, tasks — then the agents build the week. */
export function MondayPlan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [lunchBudget, setLunchBudget] = useState("12");
  const [dinnerBudget, setDinnerBudget] = useState("15");
  const [otherBudget, setOtherBudget] = useState("100");
  const [incomeExpected, setIncomeExpected] = useState("");
  const [goals, setGoals] = useState("");
  const [taskLines, setTaskLines] = useState("");
  const [calorieTarget, setCalorieTarget] = useState("2000");
  const [dietNotes, setDietNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ plan: Plan | null; meals: Meal[] }>("/planning/plan")
      .then((r) => {
        setMeals(r.meals);
        if (!r.plan) return;
        setPlan(r.plan);
        setLunchBudget(String(r.plan.lunchBudget));
        setDinnerBudget(String(r.plan.dinnerBudget));
        setOtherBudget(String(r.plan.otherBudget));
        setIncomeExpected(String(r.plan.incomeExpected || ""));
        setGoals((r.plan.goals ?? []).join("\n"));
      })
      .catch((e) => setError(e.message));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ plan: Plan; meals: Meal[] }>("/planning/plan", {
        lunchBudget: Number(lunchBudget) || 0,
        dinnerBudget: Number(dinnerBudget) || 0,
        otherBudget: Number(otherBudget) || 0,
        incomeExpected: Number(incomeExpected) || 0,
        goals: goals.split("\n").map((g) => g.trim()).filter(Boolean),
        plannedTasks: taskLines
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((title) => ({ title })),
        calorieTarget: Number(calorieTarget) || 2000,
        dietNotes: dietNotes || undefined,
      });
      setPlan(res.plan);
      setMeals(res.meals);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const advice = plan?.aiBudgetAdvice ?? null;
  const totalCalorieSaving = advice?.calorie_savings_total ?? 0;
  const gamePlan = plan?.gamePlan ?? null;

  return (
    <>
      <h1>Monday — plan the week</h1>
      <p className="muted small" style={{ marginTop: "-.3rem" }}>
        Tell the agents what's coming and what you plan to spend. They'll check it against your
        history, set your daily allowances, build a meal plan and lay out the week day by day.
      </p>
      {error && <div className="banner error">{error}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>Your intake</h3>
          <form onSubmit={submit}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label>Lunch per day</label>
                <input type="number" step="0.5" min="0" value={lunchBudget} onChange={(e) => setLunchBudget(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Dinner per day</label>
                <input type="number" step="0.5" min="0" value={dinnerBudget} onChange={(e) => setDinnerBudget(e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ marginTop: ".6rem" }}>
              <div style={{ flex: 1 }}>
                <label>Everything else this week</label>
                <input type="number" step="5" min="0" value={otherBudget} onChange={(e) => setOtherBudget(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Income expected</label>
                <input type="number" step="10" min="0" value={incomeExpected} onChange={(e) => setIncomeExpected(e.target.value)} />
              </div>
            </div>

            <div className="field" style={{ marginTop: ".6rem" }}>
              <label>Goals this week (one per line)</label>
              <textarea value={goals} onChange={(e) => setGoals(e.target.value)} placeholder={"Save $150\nCook 5 dinners\nFinish the certification module"} />
            </div>
            <div className="field">
              <label>Tasks for the week (one per line)</label>
              <textarea value={taskLines} onChange={(e) => setTaskLines(e.target.value)} placeholder={"Renew car insurance\nSubmit invoice\nCall the dentist"} />
            </div>
            <div className="row">
              <div style={{ width: 150 }}>
                <label>Daily calorie target</label>
                <input type="number" step="50" value={calorieTarget} onChange={(e) => setCalorieTarget(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Dietary notes</label>
                <input value={dietNotes} onChange={(e) => setDietNotes(e.target.value)} placeholder="e.g. no pork, high protein" />
              </div>
            </div>
            <button style={{ marginTop: ".8rem" }} disabled={busy}>
              {busy ? "Agents are planning your week…" : "Build my week"}
            </button>
          </form>
        </div>

        <div className="card">
          <h3>What the agents recommend</h3>
          {!advice ? (
            <p className="muted small">Submit your intake and the budget architect will weigh in.</p>
          ) : (
            <>
              <div className="grid cols-3" style={{ marginBottom: ".8rem" }}>
                <Mini label="Lunch/day" value={money(advice.recommended_daily_lunch)} />
                <Mini label="Dinner/day" value={money(advice.recommended_daily_dinner)} />
                <Mini label="Week cap" value={money(advice.weekly_spend_cap)} />
              </div>
              <p style={{ marginTop: 0 }}>{advice.reasoning}</p>
              <p>
                <strong>Projected savings: {money(advice.projected_savings)}</strong>
                {advice.calorie_savings_total ? ` · ${advice.calorie_savings_total.toLocaleString()} calories avoided` : ""}
              </p>
              {advice.warnings?.length > 0 && (
                <ul className="small">
                  {advice.warnings.map((w, i) => (
                    <li key={i} style={{ color: "#fbbf24" }}>
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {gamePlan && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3>Game plan — {gamePlan.theme}</h3>
          <div className="row small muted" style={{ marginBottom: ".6rem" }}>
            <span className="tag">Cap {money(gamePlan.weekly_spend_cap)}</span>
            <span className="tag">Save {money(gamePlan.savings_target)}</span>
            <span className="tag">Lunch {money(gamePlan.daily_lunch_budget)}</span>
            <span className="tag">Dinner {money(gamePlan.daily_dinner_budget)}</span>
          </div>
          {gamePlan.rules?.length > 0 && (
            <>
              <h4 style={{ marginBottom: ".3rem" }}>Rules for the week</h4>
              <ul style={{ marginTop: 0 }}>
                {gamePlan.rules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Focus</th>
                <th>Cap</th>
                <th>Tasks</th>
                <th>Meals</th>
              </tr>
            </thead>
            <tbody>
              {gamePlan.days?.map((d, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{d.day}</td>
                  <td>{d.focus}</td>
                  <td>{money(d.spend_cap)}</td>
                  <td className="small">{d.tasks?.join(", ")}</td>
                  <td className="small">{d.meals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meals.length > 0 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3>Meals for the week</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Total saved vs takeout: <strong>{money(meals.reduce((s, m) => s + m.saveVsEatOut, 0))}</strong>
            {totalCalorieSaving ? ` · ${totalCalorieSaving.toLocaleString()} calories avoided` : ""}
          </p>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Meal</th>
                <th>Dish</th>
                <th>Cal</th>
                <th>Cost</th>
                <th>Saves</th>
              </tr>
            </thead>
            <tbody>
              {meals.map((m) => (
                <tr key={m.id}>
                  <td>{DAYS[m.dayOfWeek] ?? m.dayOfWeek}</td>
                  <td>{m.meal}</td>
                  <td>
                    <strong>{m.name}</strong>
                    <div className="small muted">{m.steps}</div>
                    {Array.isArray(m.ingredients) && m.ingredients.length > 0 && (
                      <div className="small muted">{m.ingredients.join(", ")}</div>
                    )}
                  </td>
                  <td>{m.calories}</td>
                  <td>{money(m.estCost)}</td>
                  <td style={{ color: "#4ade80" }}>{money(m.saveVsEatOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: "1.15rem" }}>
        {value}
      </div>
    </div>
  );
}
