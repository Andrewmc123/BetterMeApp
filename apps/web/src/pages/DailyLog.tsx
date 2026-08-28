import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, money, todayISO } from "../api";

interface Expense {
  id: string;
  date: string;
  amount: number;
  category: string;
  merchant: string | null;
  description: string | null;
  necessity: string;
  source: string;
}
interface Activity {
  id: string;
  date: string;
  category: string;
  description: string;
  durationMin: number;
  productivity: number | null;
}
interface WorkLog {
  id: string;
  date: string;
  hours: number;
  hourlyRate: number | null;
  notes: string | null;
}

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
];
const ACTIVITY_CATEGORIES = ["work", "health", "social", "learning", "chores", "leisure", "commute", "other"];

/** The daily intake: every dollar spent, every block of time, hours worked. */
export function DailyLog() {
  const [date, setDate] = useState(todayISO());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [checkedIn, setCheckedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, a, w, c] = await Promise.all([
        api.get<{ expenses: Expense[] }>(`/log/expenses?date=${date}`),
        api.get<{ activities: Activity[] }>(`/log/activities?date=${date}`),
        api.get<{ workLogs: WorkLog[] }>(`/log/worklogs?date=${date}`),
        api.get<{ checkin: { completed: boolean } | null }>(`/log/checkin?date=${date}`),
      ]);
      setExpenses(e.expenses);
      setActivities(a.activities);
      setWorkLogs(w.workLogs);
      setCheckedIn(c.checkin?.completed ?? false);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const minutes = activities.reduce((s, a) => s + a.durationMin, 0);
  const hours = workLogs.reduce((s, w) => s + w.hours, 0);

  const finishDay = async () => {
    await api.post("/log/checkin", { date, completed: true });
    setCheckedIn(true);
  };

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>What did you do today?</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="grid cols-3" style={{ marginBottom: "1rem" }}>
        <div className="card stat">
          <div className="label">Spent</div>
          <div className="value">{money(spent)}</div>
          <div className="sub">{expenses.length} items</div>
        </div>
        <div className="card stat">
          <div className="label">Time logged</div>
          <div className="value">{(minutes / 60).toFixed(1)}h</div>
          <div className="sub">{activities.length} activities</div>
        </div>
        <div className="card stat">
          <div className="label">Worked</div>
          <div className="value">{hours.toFixed(1)}h</div>
          <div className="sub">{checkedIn ? "Day checked in ✓" : "Not checked in"}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <ExpenseSection date={date} expenses={expenses} onChange={load} />
        <ActivitySection date={date} activities={activities} onChange={load} />
        <WorkSection date={date} workLogs={workLogs} onChange={load} />

        <div className="card">
          <h3>Wrap up the day</h3>
          <p className="muted small">
            Marking the day done tells the Friday review your log is complete for {date}.
          </p>
          <button onClick={() => void finishDay()} disabled={checkedIn}>
            {checkedIn ? "Checked in ✓" : "Mark day complete"}
          </button>
        </div>
      </div>
    </>
  );
}

function ExpenseSection({ date, expenses, onChange }: { date: string; expenses: Expense[]; onChange: () => void }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food_out");
  const [merchant, setMerchant] = useState("");
  const [necessity, setNecessity] = useState("want");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/log/expenses", {
        date,
        amount: Number(amount),
        category,
        merchant: merchant || undefined,
        necessity,
      });
      setAmount("");
      setMerchant("");
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Money spent</h3>
      {error && <div className="banner error">{error}</div>}
      <form onSubmit={add}>
        <div className="row">
          <input
            style={{ width: 100 }}
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <select style={{ width: 140 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select style={{ width: 110 }} value={necessity} onChange={(e) => setNecessity(e.target.value)}>
            <option value="need">need</option>
            <option value="want">want</option>
            <option value="unknown">not sure</option>
          </select>
          <input
            style={{ flex: 1, minWidth: 120 }}
            placeholder="Where? (optional)"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
          <button disabled={busy}>Add</button>
        </div>
      </form>

      {expenses.length > 0 && (
        <table style={{ marginTop: ".8rem" }}>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td style={{ fontWeight: 600, width: 80 }}>{money(e.amount)}</td>
                <td>
                  <span className="tag">{e.category.replace(/_/g, " ")}</span>{" "}
                  {e.merchant ?? e.description ?? ""}
                  {e.source === "plaid" && <span className="tag" style={{ marginLeft: 4 }}>bank</span>}
                </td>
                <td style={{ width: 40, textAlign: "right" }}>
                  <button
                    className="small danger"
                    onClick={async () => {
                      await api.del(`/log/expenses/${e.id}`);
                      onChange();
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ActivitySection({ date, activities, onChange }: { date: string; activities: Activity[]; onChange: () => void }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("work");
  const [durationMin, setDurationMin] = useState("60");
  const [productivity, setProductivity] = useState("3");
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/log/activities", {
        date,
        category,
        description,
        durationMin: Number(durationMin),
        productivity: Number(productivity),
      });
      setDescription("");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>What you did with your time</h3>
      <form onSubmit={add}>
        <div className="field">
          <input
            placeholder="e.g. Gym, then grocery run"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>
        <div className="row">
          <select style={{ width: 130 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            style={{ width: 100 }}
            type="number"
            min="5"
            step="5"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
          />
          <span className="muted small">min</span>
          <select style={{ width: 130 }} value={productivity} onChange={(e) => setProductivity(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                worth it: {n}/5
              </option>
            ))}
          </select>
          <button disabled={busy}>Add</button>
        </div>
      </form>

      {activities.length > 0 && (
        <table style={{ marginTop: ".8rem" }}>
          <tbody>
            {activities.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 70 }}>{(a.durationMin / 60).toFixed(1)}h</td>
                <td>
                  <span className="tag">{a.category}</span> {a.description}
                </td>
                <td style={{ width: 40, textAlign: "right" }}>
                  <button
                    className="small danger"
                    onClick={async () => {
                      await api.del(`/log/activities/${a.id}`);
                      onChange();
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WorkSection({ date, workLogs, onChange }: { date: string; workLogs: WorkLog[]; onChange: () => void }) {
  const [hours, setHours] = useState("8");
  const [hourlyRate, setHourlyRate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/log/worklogs", {
        date,
        hours: Number(hours),
        hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
        notes: notes || undefined,
      });
      setNotes("");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Work hours</h3>
      <form onSubmit={add}>
        <div className="row">
          <input style={{ width: 90 }} type="number" step="0.25" min="0.25" max="24" value={hours} onChange={(e) => setHours(e.target.value)} />
          <span className="muted small">hours at</span>
          <input style={{ width: 100 }} type="number" step="0.01" min="0" placeholder="$/hr" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
          <input style={{ flex: 1, minWidth: 120 }} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button disabled={busy}>Add</button>
        </div>
      </form>

      {workLogs.length > 0 && (
        <table style={{ marginTop: ".8rem" }}>
          <tbody>
            {workLogs.map((w) => (
              <tr key={w.id}>
                <td style={{ width: 70, fontWeight: 600 }}>{w.hours}h</td>
                <td>
                  {w.hourlyRate ? `${money(w.hourlyRate)}/hr → ${money(w.hours * w.hourlyRate)}` : "no rate set"}
                  {w.notes ? ` · ${w.notes}` : ""}
                </td>
                <td style={{ width: 40, textAlign: "right" }}>
                  <button
                    className="small danger"
                    onClick={async () => {
                      await api.del(`/log/worklogs/${w.id}`);
                      onChange();
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
