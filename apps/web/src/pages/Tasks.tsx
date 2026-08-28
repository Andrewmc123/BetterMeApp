import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";

interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  remindAt: string | null;
  priority: string;
  status: string;
  completedAt: string | null;
}

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("medium");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks((await api.get<{ tasks: Task[] }>("/tasks")).tasks);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/tasks", {
        title,
        priority,
        // datetime-local gives a local wall-clock string; convert to a real instant.
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        remindAt: dueAt ? new Date(new Date(dueAt).getTime() - 60 * 60 * 1000).toISOString() : null,
      });
      setTitle("");
      setDueAt("");
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setStatus = async (id: string, status: string) => {
    await api.patch(`/tasks/${id}`, { status });
    void load();
  };

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status !== "open");

  return (
    <>
      <h1>Tasks</h1>
      <p className="muted small" style={{ marginTop: "-.3rem" }}>
        Anything with a due time shows up in the reminder bar an hour before it's due.
      </p>
      {error && <div className="banner error">{error}</div>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <form onSubmit={add}>
          <div className="row">
            <input
              style={{ flex: 1, minWidth: 200 }}
              placeholder="What needs doing?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <input style={{ width: 210 }} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <select style={{ width: 120 }} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <button>Add task</button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>Open ({open.length})</h3>
        {open.length === 0 ? (
          <p className="muted small">Nothing open. Nice.</p>
        ) : (
          <table>
            <tbody>
              {open.map((t) => {
                const overdue = t.dueAt && new Date(t.dueAt) < new Date();
                return (
                  <tr key={t.id}>
                    <td style={{ width: 34 }}>
                      <button className="small ghost" onClick={() => void setStatus(t.id, "done")} title="Complete">
                        ✓
                      </button>
                    </td>
                    <td>
                      <strong>{t.title}</strong>
                      <div className="small muted">
                        <span className="tag">{t.priority}</span>{" "}
                        {t.dueAt && (
                          <span style={overdue ? { color: "#f87171" } : undefined}>
                            {overdue ? "overdue · " : "due "}
                            {new Date(t.dueAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ width: 90, textAlign: "right" }}>
                      <button className="small danger" onClick={() => void setStatus(t.id, "dropped")}>
                        Drop
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {done.length > 0 && (
        <div className="card">
          <h3>Finished</h3>
          <table>
            <tbody>
              {done.slice(0, 30).map((t) => (
                <tr key={t.id}>
                  <td className="muted" style={{ textDecoration: t.status === "done" ? "line-through" : "none" }}>
                    {t.title}
                  </td>
                  <td className="muted small" style={{ textAlign: "right", width: 160 }}>
                    {t.status === "done" ? "done" : "dropped"}
                    {t.completedAt ? ` · ${new Date(t.completedAt).toLocaleDateString()}` : ""}
                  </td>
                  <td style={{ width: 40, textAlign: "right" }}>
                    <button
                      className="small danger"
                      onClick={async () => {
                        await api.del(`/tasks/${t.id}`);
                        void load();
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
