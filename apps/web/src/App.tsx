import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { TaskBar } from "./components/TaskBar";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { DailyLog } from "./pages/DailyLog";
import { Tasks } from "./pages/Tasks";
import { MondayPlan } from "./pages/MondayPlan";
import { FridayReview } from "./pages/FridayReview";
import { Coach } from "./pages/Coach";
import { Bank } from "./pages/Bank";
import { Settings } from "./pages/Settings";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/log", label: "Daily log" },
  { to: "/tasks", label: "Tasks" },
  { to: "/plan", label: "Monday plan" },
  { to: "/review", label: "Friday review" },
  { to: "/coach", label: "AI coach" },
  { to: "/bank", label: "Bank" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="spinner">Loading…</div>;
  if (!user) return <Login />;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          Better<span>Me</span>
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `navlink${isActive ? " active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <button className="ghost small" onClick={logout}>
          Sign out
        </button>
      </nav>

      <main className="main">
        <TaskBar />
        <Routes>
          <Route path="/" element={<Page><Dashboard /></Page>} />
          <Route path="/log" element={<Page><DailyLog /></Page>} />
          <Route path="/tasks" element={<Page><Tasks /></Page>} />
          <Route path="/plan" element={<Page><MondayPlan /></Page>} />
          <Route path="/review" element={<Page><FridayReview /></Page>} />
          <Route path="/coach" element={<Coach />} />
          <Route path="/bank" element={<Page><Bank /></Page>} />
          <Route path="/settings" element={<Page><Settings /></Page>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="content">{children}</div>;
}
