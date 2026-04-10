import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
  formatDateDmYInZone,
  formatTime24InZone,
  formatTime24SecondsInZone,
  formatUtcOffsetForZone
} from "../dateFormat";
import { useAppTimezone } from "../TimezoneContext";
import { ActiveShiftDashboardRow } from "../types";

const POLL_MS = 2000;

export function Dashboard() {
  const { timezone } = useAppTimezone();
  const [now, setNow] = useState(() => new Date());
  const [rows, setRows] = useState<ActiveShiftDashboardRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      setRows(await api.activeDashboardShifts());
    } catch {
      setError("Не удалось загрузить активные смены");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const meRole = api.meRole();
  const seesAllShifts = meRole === "Admin" || meRole === "Monitoring";

  const utcOffset = formatUtcOffsetForZone(timezone, now);

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <div
        className="dashboard-clock"
        aria-label="Текущее время"
        style={{ marginBottom: 14 }}
      >
        <time dateTime={now.toISOString()}>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "1.85rem",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.04em"
            }}
          >
            {formatTime24SecondsInZone(now, timezone)}
          </span>
        </time>
        <div style={{ marginTop: 4, fontSize: 15, color: "#555" }}>
          {formatDateDmYInZone(now.toISOString(), timezone)}
          {utcOffset ? ` · UTC${utcOffset}` : ""}
        </div>
      </div>
      <p className="subtitle">{seesAllShifts ? "Открытые смены" : "Активная смена"}</p>

      {rows.length === 0 ? (
        <p>Активных смен нет</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>№ смены</th>
                <th>Сотрудник</th>
                <th>Открыта</th>
                <th style={{ textAlign: "right" }}>Заявок</th>
                <th style={{ textAlign: "right" }}>Ковров</th>
                <th style={{ textAlign: "right" }}>м² за смену</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>{r.employee_username}</td>
                  <td>
                    {formatDateDmYInZone(r.opened_at, timezone)} {formatTime24InZone(r.opened_at, timezone)}
                  </td>
                  <td style={{ textAlign: "right" }}>{r.requests_count}</td>
                  <td style={{ textAlign: "right" }}>{r.carpets_count}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.total_area.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
