import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { authStore } from "./auth";
import { useAppTimezone } from "./TimezoneContext";
import { AdminPanel } from "./pages/AdminPanel";
import { StatsPanel } from "./pages/StatsPanel";
import { ActiveShiftPage } from "./pages/ActiveShiftPage";
import { Dashboard } from "./pages/Dashboard";
import { JournalPage } from "./pages/JournalPage";
import { LoginPage } from "./pages/LoginPage";
import { RequestPage } from "./pages/RequestPage";

function Protected({ children }: { children: JSX.Element }) {
  return authStore.access() ? children : <Navigate to="/login" replace />;
}

export function App() {
  const nav = useNavigate();
  const { refresh: refreshTimezone } = useAppTimezone();
  const isAuthed = !!authStore.access();
  const role = authStore.role();
  const isMonitoring = role === "Monitoring";
  const isAdmin = role === "Admin";
  const loggedAs = authStore.username();

  return (
    <div className="app-shell">
      {isAuthed && (
        <header className="app-nav">
          {loggedAs && (
            <div className="app-nav-user">
              Сотрудник: <b>{loggedAs}</b>
            </div>
          )}
          <ul className="app-nav-links">
            <li>
              <Link className="app-nav-link" to="/">
                Dashboard
              </Link>
            </li>
            {!isMonitoring && (
              <>
                <li>
                  <Link className="app-nav-link" to="/shift">
                    Смена
                  </Link>
                </li>
                <li>
                  <Link className="app-nav-link" to="/request">
                    Заявка
                  </Link>
                </li>
                <li>
                  <Link className="app-nav-link" to="/journal">
                    Журнал
                  </Link>
                </li>
              </>
            )}
            {isAdmin && (
              <>
                <li>
                  <Link className="app-nav-link" to="/stats">
                    Статистика
                  </Link>
                </li>
                <li>
                  <Link className="app-nav-link" to="/admin">
                    Админ
                  </Link>
                </li>
              </>
            )}
          </ul>
          <button
            type="button"
            className="app-nav-out"
            onClick={() => {
              authStore.clear();
              void refreshTimezone();
              nav("/login");
            }}
          >
            Выйти
          </button>
        </header>
      )}

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route
          path="/shift"
          element={
            <Protected>
              {isMonitoring ? <Navigate to="/" replace /> : <ActiveShiftPage />}
            </Protected>
          }
        />
        <Route
          path="/request"
          element={
            <Protected>
              {isMonitoring ? <Navigate to="/" replace /> : <RequestPage />}
            </Protected>
          }
        />
        <Route
          path="/journal"
          element={
            <Protected>
              {isMonitoring ? <Navigate to="/" replace /> : <JournalPage />}
            </Protected>
          }
        />
        <Route
          path="/stats"
          element={<Protected>{isAdmin ? <StatsPanel /> : <Navigate to="/" replace />}</Protected>}
        />
        <Route
          path="/admin"
          element={<Protected>{isAdmin ? <AdminPanel /> : <Navigate to="/" replace />}</Protected>}
        />
      </Routes>
    </div>
  );
}
