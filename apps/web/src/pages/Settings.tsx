import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

export function Settings() {
  const { user, refresh, logout } = useAuth();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [savingsGoal, setSavingsGoal] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ agents: { ok: boolean } } | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setTimezone(user.timezone);
    setMonthlyIncome(user.monthlyIncome?.toString() ?? "");
    setSavingsGoal(user.savingsGoal?.toString() ?? "");
  }, [user]);

  useEffect(() => {
    api.get<{ agents: { ok: boolean } }>("/health").then(setHealth).catch(() => undefined);
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api.patch("/auth/me", {
        name,
        timezone,
        monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
        savingsGoal: savingsGoal ? Number(savingsGoal) : null,
      });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h1>Settings</h1>
      {error && <div className="banner error">{error}</div>}
      {saved && <div className="banner ok">Saved.</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>Your profile</h3>
          <form onSubmit={save}>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Timezone</label>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" />
            </div>
            <div className="field">
              <label>Monthly income (helps the cash-flow agent)</label>
              <input type="number" step="50" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value)} />
            </div>
            <div className="field">
              <label>Monthly savings goal</label>
              <input type="number" step="25" value={savingsGoal} onChange={(e) => setSavingsGoal(e.target.value)} />
            </div>
            <button>Save</button>
          </form>
        </div>

        <div className="card">
          <h3>System</h3>
          <p className="small">
            AI agent service:{" "}
            {health ? (
              health.agents.ok ? (
                <span style={{ color: "#4ade80" }}>connected</span>
              ) : (
                <span style={{ color: "#f87171" }}>unreachable</span>
              )
            ) : (
              "checking…"
            )}
          </p>
          <p className="muted small">
            The weekly review runs every Friday at 22:00 UTC and the Monday intake reminder at 12:00
            UTC. Bank transactions sync daily at 06:00 UTC. You can always run either workflow by hand
            from its page.
          </p>
          <p className="muted small">
            BetterMe gives budgeting and habit guidance, not investment, tax or credit advice.
          </p>
          <button className="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
