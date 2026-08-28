import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

interface Task {
  id: string;
  title: string;
  dueAt: string | null;
  priority: string;
}

interface DueResponse {
  overdue: Task[];
  dueSoon: Task[];
  remindNow: Task[];
  count: number;
}

/**
 * Always-visible reminder strip. Polls every 60s so a task that becomes due
 * while the app is open still surfaces without a refresh.
 */
export function TaskBar() {
  const [data, setData] = useState<DueResponse | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await api.get<DueResponse>("/tasks/due"));
    } catch {
      /* the bar is non-critical — stay quiet on failure */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const complete = async (id: string) => {
    setDismissed((d) => [...d, id]);
    await api.patch(`/tasks/${id}`, { status: "done" });
    void load();
  };

  if (!data) return null;

  const overdue = data.overdue.filter((t) => !dismissed.includes(t.id));
  const soon = data.dueSoon.filter((t) => !dismissed.includes(t.id));
  const next = overdue[0] ?? soon[0];

  if (!next) {
    return (
      <div className="taskbar">
        <span className="pill">Tasks</span>
        <span className="muted">Nothing due right now.</span>
        <span className="spacer" />
        <Link to="/tasks" className="small">
          Manage tasks
        </Link>
      </div>
    );
  }

  return (
    <div className={`taskbar${overdue.length ? " alert" : ""}`}>
      <span className={`pill ${overdue.length ? "danger" : "warn"}`}>
        {overdue.length ? `${overdue.length} overdue` : "Due soon"}
      </span>
      <strong>{next.title}</strong>
      {next.dueAt && (
        <span className="muted small">{new Date(next.dueAt).toLocaleString()}</span>
      )}
      <button className="small ghost" onClick={() => void complete(next.id)}>
        Mark done
      </button>
      <span className="spacer" />
      {overdue.length + soon.length > 1 && (
        <span className="muted small">+{overdue.length + soon.length - 1} more</span>
      )}
      <Link to="/tasks" className="small">
        All tasks
      </Link>
    </div>
  );
}
