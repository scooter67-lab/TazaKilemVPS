import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { isoDateToDmY } from "../dateFormat";
import { AdminShiftsSection } from "./AdminShiftsSection";
import { RequestStatRow, Stats, User } from "../types";

/** Строки с одним и тем же номером заявки сливаем, суммируя ковры и площадь (разные смены / id). */
function mergeRequestRowsByNumber(rows: RequestStatRow[]): RequestStatRow[] {
  const map = new Map<string, RequestStatRow>();
  for (const r of rows) {
    const key = r.request_number.trim().toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
    } else {
      map.set(key, {
        ...prev,
        id: Math.min(prev.id, r.id),
        carpets_count: prev.carpets_count + r.carpets_count,
        total_area: prev.total_area + r.total_area
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.request_number.localeCompare(b.request_number, undefined, { numeric: true, sensitivity: "base" })
  );
}

function openNativeDatePicker(ref: React.RefObject<HTMLInputElement | null>) {
  const el = ref.current;
  if (!el) return;
  try {
    el.showPicker();
  } catch {
    el.focus();
    try {
      el.click();
    } catch {
      /* ignore */
    }
  }
}

export function StatsPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [requestRows, setRequestRows] = useState<RequestStatRow[]>([]);
  const [requestSearch, setRequestSearch] = useState("");
  const [statsUserId, setStatsUserId] = useState("");
  const [statsDateFrom, setStatsDateFrom] = useState("");
  const [statsDateTo, setStatsDateTo] = useState("");
  /** Период только для таблицы заявок; пусто — берутся даты сводки сверху. */
  const [requestDateFrom, setRequestDateFrom] = useState("");
  const [requestDateTo, setRequestDateTo] = useState("");
  const [statsLoading, setStatsLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const statsDateFromRef = useRef<HTMLInputElement>(null);
  const statsDateToRef = useRef<HTMLInputElement>(null);
  const requestDateFromRef = useRef<HTMLInputElement>(null);
  const requestDateToRef = useRef<HTMLInputElement>(null);

  const statsQuery = () => ({
    userId: statsUserId ? Number(statsUserId) : undefined,
    dateFrom: statsDateFrom || undefined,
    dateTo: statsDateTo || undefined
  });

  const requestsQuery = () => {
    const s = statsQuery();
    return {
      userId: s.userId,
      dateFrom: requestDateFrom || s.dateFrom,
      dateTo: requestDateTo || s.dateTo
    };
  };

  const mergedRequestRows = useMemo(() => mergeRequestRowsByNumber(requestRows), [requestRows]);

  const displayRequestRows = useMemo(() => {
    const t = requestSearch.trim().toLowerCase();
    if (!t) return mergedRequestRows;
    return mergedRequestRows.filter((r) => {
      const idStr = String(r.id).toLowerCase();
      const numStr = r.request_number.toLowerCase();
      return idStr.includes(t) || numStr.includes(t);
    });
  }, [mergedRequestRows, requestSearch]);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      setStats(await api.stats(statsQuery()));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось загрузить статистику");
    } finally {
      setStatsLoading(false);
    }
  };

  const loadRequestsOnly = async () => {
    setRequestsLoading(true);
    try {
      setRequestRows(await api.statsRequests(requestsQuery()));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось загрузить заявки");
      setRequestRows([]);
    } finally {
      setRequestsLoading(false);
    }
  };

  const resetStatsFilters = async () => {
    setStatsUserId("");
    setStatsDateFrom("");
    setStatsDateTo("");
    setRequestDateFrom("");
    setRequestDateTo("");
    setRequestSearch("");
    setStatsLoading(true);
    try {
      const [s, rq] = await Promise.all([api.stats({}), api.statsRequests({})]);
      setStats(s);
      setRequestRows(rq);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось загрузить статистику");
      setRequestRows([]);
    } finally {
      setStatsLoading(false);
    }
  };

  const load = async () => {
    const u = await api.users();
    setUsers(u);
    setStatsLoading(true);
    try {
      const [s, rq] = await Promise.all([api.stats({}), api.statsRequests({})]);
      setStats(s);
      setRequestRows(rq);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось загрузить статистику");
      setRequestRows([]);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="stats-page">
      <h2 className="page-title">Статистика</h2>

      <div className="stats-filters-card">
        <label className="stats-field-label">
          <span>Сотрудник</span>
          <select value={statsUserId} onChange={(e) => setStatsUserId(e.target.value)}>
            <option value="">Все</option>
            {users.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.username}
              </option>
            ))}
          </select>
        </label>
        <div className="stats-dates-actions">
          <div className="stats-date-row">
            <div className="stats-date-col">
              <span id="stats-from-label">С даты</span>
              <div className="stat-date-field">
                <input
                  ref={statsDateFromRef}
                  id="stats-date-from"
                  className="stat-date-native"
                  type="date"
                  value={statsDateFrom}
                  onChange={(e) => setStatsDateFrom(e.target.value)}
                  aria-labelledby="stats-from-label"
                />
                <button
                  type="button"
                  className={`stat-date-visible${statsDateFrom ? "" : " is-placeholder"}`}
                  onClick={() => openNativeDatePicker(statsDateFromRef)}
                >
                  {statsDateFrom ? isoDateToDmY(statsDateFrom) : "дд.мм.гггг"}
                </button>
              </div>
            </div>
            <div className="stats-date-col">
              <span id="stats-to-label">По дату</span>
              <div className="stat-date-field">
                <input
                  ref={statsDateToRef}
                  id="stats-date-to"
                  className="stat-date-native"
                  type="date"
                  value={statsDateTo}
                  onChange={(e) => setStatsDateTo(e.target.value)}
                  aria-labelledby="stats-to-label"
                />
                <button
                  type="button"
                  className={`stat-date-visible${statsDateTo ? "" : " is-placeholder"}`}
                  onClick={() => openNativeDatePicker(statsDateToRef)}
                >
                  {statsDateTo ? isoDateToDmY(statsDateTo) : "дд.мм.гггг"}
                </button>
              </div>
            </div>
          </div>
          <div className="stats-actions-row">
            <button type="button" disabled={statsLoading} onClick={() => void loadStats()}>
              {statsLoading ? "…" : "Показать"}
            </button>
            <button type="button" disabled={statsLoading} onClick={() => void resetStatsFilters()}>
              Сбросить фильтры
            </button>
          </div>
        </div>
      </div>

      {!stats ? (
        <p>Нет данных</p>
      ) : (
        <div className="stats-summary">
          <div className="stats-kpis">
            <span>Всего заявок: {stats.total_requests}</span>
            <span>Общая квадратура: {stats.total_area.toFixed(2)} м²</span>
          </div>
          <div className="table-scroll">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Смен</th>
                  <th>Квадратура</th>
                </tr>
              </thead>
              <tbody>
                {stats.employees.map((employee) => (
                  <tr key={employee.username}>
                    <td>{employee.username}</td>
                    <td>{employee.shifts}</td>
                    <td>{employee.area.toFixed(2)} м²</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section className="stats-section" aria-labelledby="stats-requests-heading">
        <h3 id="stats-requests-heading" className="stats-section-title">
          Заявки
        </h3>

        <div className="stats-filters-card">
          <div className="stats-dates-actions">
            <div className="stats-date-row">
              <div className="stats-date-col">
                <span id="stats-requests-from-label">С даты (заявки)</span>
                <div className="stat-date-field">
                  <input
                    ref={requestDateFromRef}
                    id="stats-requests-date-from"
                    className="stat-date-native"
                    type="date"
                    value={requestDateFrom}
                    onChange={(e) => setRequestDateFrom(e.target.value)}
                    aria-labelledby="stats-requests-from-label"
                  />
                  <button
                    type="button"
                    className={`stat-date-visible${requestDateFrom ? "" : " is-placeholder"}`}
                    onClick={() => openNativeDatePicker(requestDateFromRef)}
                  >
                    {requestDateFrom ? isoDateToDmY(requestDateFrom) : "дд.мм.гггг"}
                  </button>
                </div>
              </div>
              <div className="stats-date-col">
                <span id="stats-requests-to-label">По дату (заявки)</span>
                <div className="stat-date-field">
                  <input
                    ref={requestDateToRef}
                    id="stats-requests-date-to"
                    className="stat-date-native"
                    type="date"
                    value={requestDateTo}
                    onChange={(e) => setRequestDateTo(e.target.value)}
                    aria-labelledby="stats-requests-to-label"
                  />
                  <button
                    type="button"
                    className={`stat-date-visible${requestDateTo ? "" : " is-placeholder"}`}
                    onClick={() => openNativeDatePicker(requestDateToRef)}
                  >
                    {requestDateTo ? isoDateToDmY(requestDateTo) : "дд.мм.гггг"}
                  </button>
                </div>
              </div>
            </div>
            <div className="stats-actions-row">
              <button type="button" disabled={requestsLoading} onClick={() => void loadRequestsOnly()}>
                {requestsLoading ? "…" : "Показать"}
              </button>
            </div>
          </div>
          <label className="stats-search-field">
            <span>Поиск по заявке</span>
            <input
              type="search"
              value={requestSearch}
              onChange={(e) => setRequestSearch(e.target.value)}
              placeholder="Номер или ID заявки…"
              autoComplete="off"
              enterKeyHint="search"
            />
          </label>
        </div>

        {requestSearch.trim() ? (
          <p className="stats-count-hint">
            Показано: {displayRequestRows.length} из {mergedRequestRows.length}
          </p>
        ) : null}

        <div className="table-scroll">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>ID</th>
                <th>Номер</th>
                <th>Ковров</th>
                <th>м²</th>
              </tr>
            </thead>
            <tbody>
              {displayRequestRows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "#666" }}>
                    {mergedRequestRows.length === 0
                      ? "Нет заявок в выбранном периоде."
                      : "Ничего не найдено — измените поиск."}
                  </td>
                </tr>
              ) : (
                displayRequestRows.map((r) => (
                  <tr key={r.request_number}>
                    <td>{r.id}</td>
                    <td>{r.request_number}</td>
                    <td>{r.carpets_count}</td>
                    <td>{r.total_area.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <hr className="stats-page-divider" />
      <AdminShiftsSection />
    </div>
  );
}
