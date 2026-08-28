import { useEffect, useState } from "react";
import { api, money } from "../api";
import { Markdown } from "../components/Markdown";

interface Leak {
  label: string;
  category: string;
  amount: number;
  occurrences: number;
  annualized: number;
  verdict: string;
  reasoning: string;
}

interface Review {
  weekStart: string;
  weekEnd: string;
  totalSpent: number;
  totalHours: number;
  wastedSpend: number;
  couldHaveSaved: number;
  narrative: string;
  breakdown: {
    by_category?: Array<{ category: string; amount: number; transactions: number }>;
    grade?: string;
    top_three_moves?: string[];
    grocery_list?: string[];
    calories_saved_estimate?: number;
  };
  agentReports: {
    spending_forensics?: { headline: string; leaks: Leak[]; total_avoidable: number; repeat_merchants: string[] };
    cash_flow?: { headline: string; why_broke: string[]; structural_fixes: string[]; net: number; burn_rate_per_day: number };
    time_audit?: { headline: string; time_money_link: string; reclaimable_hours: number; reclaim_moves: string[] };
    meal_strategy?: { headline: string; dollars_saved_estimate: number; calories_saved_estimate: number; grocery_list: string[] };
  };
  nextWeekPlan: {
    theme?: string;
    weekly_spend_cap?: number;
    savings_target?: number;
    rules?: string[];
    days?: Array<{ day: string; focus: string; spend_cap: number; tasks: string[]; meals: string }>;
  };
}

/** The Friday post-mortem: five agents' worth of analysis, in one page. */
export function FridayReview() {
  const [review, setReview] = useState<Review | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; weekStart: string; totalSpent: number; couldHaveSaved: number }>>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ review: Review | null }>("/planning/review").then((r) => setReview(r.review)).catch((e) => setError(e.message));
    api.get<{ reviews: typeof history }>("/planning/reviews").then((r) => setHistory(r.reviews)).catch(() => undefined);
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<{ review: Review }>("/planning/review/run", {});
      setReview(res.review);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const spending = review?.agentReports?.spending_forensics;
  const cash = review?.agentReports?.cash_flow;
  const time = review?.agentReports?.time_audit;
  const meal = review?.agentReports?.meal_strategy;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Friday review</h1>
          <p className="muted small" style={{ marginTop: "-.3rem" }}>
            Five agents read your week: spending forensics, cash flow, time audit, meal strategy, and
            a chief strategist who writes the plan.
          </p>
        </div>
        <button onClick={() => void run()} disabled={running}>
          {running ? "Agents are working…" : review ? "Re-run review" : "Run this week's review"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {running && (
        <div className="banner">
          Running the full agent team over your week. This takes a minute or two — the specialists
          run in parallel, then the strategist writes the plan.
        </div>
      )}

      {!review && !running && (
        <div className="card">
          <p className="muted">
            No review for this week yet. It runs automatically every Friday evening, or you can run it
            now from the button above.
          </p>
        </div>
      )}

      {review && (
        <>
          <div className="grid cols-4" style={{ marginBottom: "1rem" }}>
            <div className="card stat">
              <div className="label">Week grade</div>
              <div className="value">{review.breakdown?.grade ?? "—"}</div>
              <div className="sub">
                {review.weekStart?.slice(0, 10)} → {review.weekEnd?.slice(0, 10)}
              </div>
            </div>
            <div className="card stat">
              <div className="label">Spent</div>
              <div className="value">{money(review.totalSpent)}</div>
              <div className="sub">{review.totalHours}h worked</div>
            </div>
            <div className="card stat">
              <div className="label">Wasted</div>
              <div className="value bad">{money(review.wastedSpend)}</div>
              <div className="sub">avoidable spending</div>
            </div>
            <div className="card stat">
              <div className="label">Could have saved</div>
              <div className="value good">{money(review.couldHaveSaved)}</div>
              <div className="sub">{money(review.couldHaveSaved * 52)}/yr if repeated</div>
            </div>
          </div>

          {review.breakdown?.top_three_moves && review.breakdown.top_three_moves.length > 0 && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3>Do these three things</h3>
              <ol style={{ marginBottom: 0 }}>
                {review.breakdown.top_three_moves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="card" style={{ marginBottom: "1rem" }}>
            <Markdown text={review.narrative} />
          </div>

          <div className="grid cols-2">
            {spending && (
              <div className="card">
                <h3>Spending forensics</h3>
                <p>{spending.headline}</p>
                {spending.leaks?.length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Leak</th>
                        <th>Week</th>
                        <th>Per year</th>
                        <th>Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spending.leaks.map((l, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{l.label}</strong>
                            <div className="small muted">
                              {l.occurrences}× · {l.reasoning}
                            </div>
                          </td>
                          <td>{money(l.amount)}</td>
                          <td>{money(l.annualized)}</td>
                          <td>
                            <span
                              className="tag"
                              style={{ color: l.verdict === "cut" ? "#f87171" : l.verdict === "reduce" ? "#fbbf24" : "#4ade80" }}
                            >
                              {l.verdict}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {cash && (
              <div className="card">
                <h3>Why you're short</h3>
                <p>{cash.headline}</p>
                <div className="row small muted" style={{ marginBottom: ".5rem" }}>
                  <span className="tag">Net {money(cash.net)}</span>
                  <span className="tag">Burn {money(cash.burn_rate_per_day)}/day</span>
                </div>
                <ol>
                  {cash.why_broke?.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
                <h4>Structural fixes</h4>
                <ul style={{ marginBottom: 0 }}>
                  {cash.structural_fixes?.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {time && (
              <div className="card">
                <h3>Time audit</h3>
                <p>{time.headline}</p>
                <p className="small">{time.time_money_link}</p>
                <p className="small muted">Reclaimable: {time.reclaimable_hours}h/week</p>
                <ul style={{ marginBottom: 0 }}>
                  {time.reclaim_moves?.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {meal && (
              <div className="card">
                <h3>Meal strategy</h3>
                <p>{meal.headline}</p>
                <div className="row small" style={{ marginBottom: ".5rem" }}>
                  <span className="tag" style={{ color: "#4ade80" }}>
                    saves {money(meal.dollars_saved_estimate)}
                  </span>
                  <span className="tag" style={{ color: "#4ade80" }}>
                    {meal.calories_saved_estimate?.toLocaleString()} calories avoided
                  </span>
                </div>
                {meal.grocery_list?.length > 0 && (
                  <>
                    <h4>Grocery list</h4>
                    <p className="small muted" style={{ marginBottom: 0 }}>{meal.grocery_list.join(", ")}</p>
                  </>
                )}
              </div>
            )}
          </div>

          {review.nextWeekPlan?.days && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h3>Next week — {review.nextWeekPlan.theme}</h3>
              <div className="row small muted" style={{ marginBottom: ".6rem" }}>
                <span className="tag">Cap {money(review.nextWeekPlan.weekly_spend_cap ?? 0)}</span>
                <span className="tag">Save {money(review.nextWeekPlan.savings_target ?? 0)}</span>
              </div>
              {review.nextWeekPlan.rules && (
                <ul>
                  {review.nextWeekPlan.rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
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
                  {review.nextWeekPlan.days.map((d, i) => (
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
        </>
      )}

      {history.length > 1 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3>Past weeks</h3>
          <table>
            <thead>
              <tr>
                <th>Week</th>
                <th>Spent</th>
                <th>Could have saved</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.weekStart.slice(0, 10)}</td>
                  <td>{money(h.totalSpent)}</td>
                  <td style={{ color: "#4ade80" }}>{money(h.couldHaveSaved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
