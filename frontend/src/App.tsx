import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
  const location = useLocation();
  const { refresh: refreshTimezone } = useAppTimezone();
  const isAuthed = !!authStore.access();
  const role = authStore.role();
  const isMonitoring = role === "Monitoring";
  const isAdmin = role === "Admin";
  const loggedAs = authStore.username();
  const [navMenuOpen, setNavMenuOpen] = useState(false);

  useEffect(() => {
    setNavMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navMenuOpen]);

  useEffect(() => {
    if (!navMenuOpen) return;
    const mq = window.matchMedia("(min-width: 720px)");
    const onChange = () => {
      if (mq.matches) setNavMenuOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [navMenuOpen]);

  useEffect(() => {
    if (!isAuthed || !navMenuOpen) {
      document.body.style.overflow = "";
      return;
    }
    const mq = window.matchMedia("(max-width: 719px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isAuthed, navMenuOpen]);

  const closeNavMenu = () => setNavMenuOpen(false);

  return (
    <div className="app-shell">
      {isAuthed && navMenuOpen && <div className="app-nav-scrim" role="presentation" onClick={closeNavMenu} />}
      {isAuthed && (
        <header className={`app-nav${navMenuOpen ? " app-nav--open" : ""}`}>
          <div className="app-nav-mobile-bar">
            <button
              type="button"
              className="app-nav-burger"
              aria-expanded={navMenuOpen}
              aria-controls="app-nav-panel"
              onClick={() => setNavMenuOpen((o) => !o)}
            >
              <span className="app-nav-burger-lines" aria-hidden>
                <span className="app-nav-burger-line" />
                <span className="app-nav-burger-line" />
                <span className="app-nav-burger-line" />
              </span>
              <span className="visually-hidden">
                {navMenuOpen ? "Закрыть меню навигации" : "Открыть меню навигации"}
              </span>
            </button>
            {loggedAs ? (
              <div className="app-nav-mobile-user" title={loggedAs}>
                Сотрудник: <b>{loggedAs}</b>
              </div>
            ) : null}
          </div>
          <div id="app-nav-panel" className="app-nav-panel">
            {loggedAs && (
              <div className="app-nav-user">
                Сотрудник: <b>{loggedAs}</b>
              </div>
            )}
            <ul className="app-nav-links">
              <li>
                <Link className="app-nav-link" to="/" onClick={closeNavMenu}>
                  Dashboard
                </Link>
              </li>
              {!isMonitoring && (
                <>
                  <li>
                    <Link className="app-nav-link" to="/shift" onClick={closeNavMenu}>
                      Смена
                    </Link>
                  </li>
                  <li>
                    <Link className="app-nav-link" to="/request" onClick={closeNavMenu}>
                      Заявка
                    </Link>
                  </li>
                  <li>
                    <Link className="app-nav-link" to="/journal" onClick={closeNavMenu}>
                      Журнал
                    </Link>
                  </li>
                </>
              )}
              {isAdmin && (
                <>
                  <li>
                    <Link className="app-nav-link" to="/stats" onClick={closeNavMenu}>
                      Статистика
                    </Link>
                  </li>
                  <li>
                    <Link className="app-nav-link" to="/admin" onClick={closeNavMenu}>
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
                closeNavMenu();
                authStore.clear();
                void refreshTimezone();
                nav("/login");
              }}
            >
              Выйти
            </button>
          </div>
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
