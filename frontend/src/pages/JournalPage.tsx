import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { formatDateTimeInZone } from "../dateFormat";
import { useAppTimezone } from "../TimezoneContext";
import { Journal, RequestItem } from "../types";

type DetailState = { journal: Journal; request: RequestItem };

export function JournalPage() {
  const { timezone } = useAppTimezone();
  const [items, setItems] = useState<Journal[]>([]);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [collapsedShiftIds, setCollapsedShiftIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .journals()
      .then((journals) => {
        setItems(journals);
        setCollapsedShiftIds(new Set(journals.map((j) => j.shift_id)));
      })
      .catch(() => {
        setItems([]);
        setCollapsedShiftIds(new Set());
      });
  }, []);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [detail]);

  const search = query.trim().toLowerCase();

  /**
   * Одна заявка может встречаться в нескольких сменах: часть ковров постирали
   * в один день, часть в другой. Поэтому при поиске оставляем все смены, где
   * номер встретился, и внутри каждой — только совпавшие заявки.
   */
  const rows = useMemo(() => {
    if (!search) return items.map((journal) => ({ journal, requests: journal.requests }));
    return items
      .map((journal) => ({
        journal,
        requests: journal.requests.filter((r) => r.request_number.toLowerCase().includes(search))
      }))
      .filter((row) => row.requests.length > 0);
  }, [items, search]);

  const found = useMemo(() => {
    if (!search) return null;
    const requests = rows.flatMap((row) => row.requests);
    return {
      shifts: rows.length,
      carpets: requests.reduce((sum, r) => sum + r.carpets.length, 0),
      area: requests.reduce((sum, r) => sum + r.total_area, 0)
    };
  }, [rows, search]);

  const modal =
    detail &&
    createPortal(
      <div
        className="journal-modal-overlay"
        role="presentation"
        onClick={() => setDetail(null)}
      >
        <div
          className="journal-modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="journal-request-detail-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h3
            id="journal-request-detail-title"
            style={{ margin: "0 0 6px", fontSize: "clamp(1.1rem, 3.5vw, 1.25rem)" }}
          >
            Заявка {detail.request.request_number}
          </h3>
          <p style={{ margin: "0 0 14px", fontSize: 14, color: "#444", lineHeight: 1.45 }}>
            Смена #{detail.journal.shift_id} · {detail.journal.user}
            <br />
            {formatDateTimeInZone(detail.journal.date, timezone)}
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 14 }}>
            Ковров: {detail.request.carpets.length} · Площадь:{" "}
            <b>{detail.request.total_area.toFixed(2)} м²</b>
          </p>
          <div className="table-scroll" style={{ marginBottom: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Длина, м</th>
                  <th>Ширина, м</th>
                  <th>Площадь, м²</th>
                </tr>
              </thead>
              <tbody>
                {[...detail.request.carpets]
                  .sort((a, b) => a.id - b.id)
                  .map((c, idx) => (
                    <tr key={c.id}>
                      <td>{idx + 1}</td>
                      <td>{c.length}</td>
                      <td>{c.width}</td>
                      <td>{c.area.toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {detail.request.carpets.length === 0 ? (
            <p style={{ margin: "0 0 14px", fontSize: 14, color: "#666" }}>Ковров в заявке нет.</p>
          ) : null}
          <button type="button" onClick={() => setDetail(null)}>
            Закрыть
          </button>
        </div>
      </div>,
      document.body
    );

  const toggleShift = (shiftId: number) => {
    setCollapsedShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(shiftId)) {
        next.delete(shiftId);
      } else {
        next.add(shiftId);
      }
      return next;
    });
  };

  return (
    <div>
      <h2 className="page-title">Журнал</h2>
      {modal}

      <div className="journal-search">
        <input
          type="search"
          className="journal-search-input"
          placeholder="Номер заявки"
          aria-label="Поиск по номеру заявки"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {search ? (
          <button type="button" className="journal-card-toggle-btn" onClick={() => setQuery("")}>
            Сбросить
          </button>
        ) : null}
      </div>

      {found ? (
        found.shifts === 0 ? (
          <p className="journal-search-note">Заявка «{query.trim()}» в журнале не найдена.</p>
        ) : (
          <p className="journal-search-note">
            Смен: <b>{found.shifts}</b> · ковров: <b>{found.carpets}</b> · всего по заявке:{" "}
            <b>{found.area.toFixed(2)} м²</b>
          </p>
        )
      ) : null}

      {rows.map(({ journal: j, requests }) => {
        // При поиске смены всегда раскрыты: иначе результат не виден.
        const expanded = !!search || !collapsedShiftIds.has(j.shift_id);
        return (
          <article key={j.shift_id} className="journal-card">
            <div className="journal-card-header">
              <div style={{ fontSize: 16, lineHeight: 1.5 }}>
                <b>Смена #{j.shift_id}</b> · {j.user}
                <br />
                {formatDateTimeInZone(j.date, timezone)}
              </div>
              {search ? null : (
                <button
                  type="button"
                  className="journal-card-toggle-btn"
                  onClick={() => toggleShift(j.shift_id)}
                  aria-expanded={expanded}
                >
                  {expanded ? "Свернуть" : "Развернуть"}
                </button>
              )}
            </div>
            {expanded ? (
              <ul className="journal-request-list">
                {requests.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="journal-request-detail-btn"
                      onClick={() => setDetail({ journal: j, request: r })}
                    >
                      {r.request_number} — {r.total_area.toFixed(2)} м², ковров: {r.carpets.length}
                      <span style={{ display: "block", fontSize: 13, color: "#1565c0", marginTop: 4 }}>
                        Просмотр деталей
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <b>Итог смены: {j.total_area.toFixed(2)} м²</b>
          </article>
        );
      })}
    </div>
  );
}
