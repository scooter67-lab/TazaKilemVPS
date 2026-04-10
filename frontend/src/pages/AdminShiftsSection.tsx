import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { formatDateTimeInZone } from "../dateFormat";
import { useAppTimezone } from "../TimezoneContext";
import { Carpet, RequestItem, ShiftAdmin } from "../types";

function shiftStatusLabel(status: string): string {
  if (status === "closed") return "закрыта";
  if (status === "active") return "открыта";
  return status;
}

function AdminCarpetRow({
  carpet,
  onReload
}: {
  carpet: Carpet;
  onReload: () => Promise<void>;
}) {
  const [len, setLen] = useState(String(carpet.length));
  const [wid, setWid] = useState(String(carpet.width));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLen(String(carpet.length));
    setWid(String(carpet.width));
  }, [carpet.id, carpet.length, carpet.width]);

  const save = async () => {
    const ln = Number(len);
    const wd = Number(wid);
    if (Number.isNaN(ln) || Number.isNaN(wd) || ln <= 0 || wd <= 0) return;
    setSaving(true);
    try {
      await api.updateCarpet(carpet.id, ln, wd);
      await onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm("Удалить этот ковёр?")) return;
    try {
      await api.deleteCarpet(carpet.id);
      await onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  return (
    <tr>
      <td>{carpet.id}</td>
      <td>
        <input
          className="admin-carpet-dim-input"
          type="number"
          min={0.01}
          step={0.01}
          value={len}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setLen(e.target.value)}
        />
      </td>
      <td>
        <input
          className="admin-carpet-dim-input"
          type="number"
          min={0.01}
          step={0.01}
          value={wid}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setWid(e.target.value)}
        />
      </td>
      <td>{carpet.area.toFixed(2)}</td>
      <td>
        <div className="admin-carpet-row-actions">
          <button type="button" disabled={saving} onClick={save}>
            {saving ? "…" : "Сохранить"}
          </button>
          <button type="button" onClick={del}>
            Удалить
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Таблица всех смен с заявками и коврами (раньше была в админ-панели). */
export function AdminShiftsSection() {
  const { timezone } = useAppTimezone();
  const [shifts, setShifts] = useState<ShiftAdmin[]>([]);
  const [expandedShiftId, setExpandedShiftId] = useState<number | null>(null);
  const [requestsByShift, setRequestsByShift] = useState<Record<number, RequestItem[]>>({});
  const [loadingShiftId, setLoadingShiftId] = useState<number | null>(null);
  const [draftNumber, setDraftNumber] = useState<Record<number, string>>({});
  const [shiftDeleteConfirmId, setShiftDeleteConfirmId] = useState<number | null>(null);
  const [shiftDeleteLoading, setShiftDeleteLoading] = useState(false);

  const loadShifts = async () => {
    setShifts(await api.shifts());
  };

  useEffect(() => {
    void loadShifts();
  }, []);

  const reloadRequestsForShift = async (shiftId: number) => {
    const list = await api.shiftRequests(shiftId);
    setRequestsByShift((m) => ({ ...m, [shiftId]: list }));
    setDraftNumber((d) => {
      const next = { ...d };
      for (const r of list) next[r.id] = r.request_number;
      return next;
    });
  };

  const toggleRequests = async (shiftId: number) => {
    if (expandedShiftId === shiftId) {
      setExpandedShiftId(null);
      return;
    }
    setExpandedShiftId(shiftId);
    if (requestsByShift[shiftId]) return;
    setLoadingShiftId(shiftId);
    try {
      await reloadRequestsForShift(shiftId);
    } finally {
      setLoadingShiftId(null);
    }
  };

  const saveRequestNumber = async (shiftId: number, reqId: number) => {
    const num = (draftNumber[reqId] ?? "").trim();
    if (!num) return;
    try {
      await api.updateRequest(reqId, num);
      await reloadRequestsForShift(shiftId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const deleteRequestRow = async (shiftId: number, r: RequestItem) => {
    if (!confirm(`Удалить заявку «${r.request_number}» и все ковры в ней?`)) return;
    try {
      await api.deleteRequest(r.id);
      await reloadRequestsForShift(shiftId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const executeDeleteShift = async (s: ShiftAdmin) => {
    setShiftDeleteLoading(true);
    try {
      await api.deleteShift(s.id);
      setShiftDeleteConfirmId(null);
      if (expandedShiftId === s.id) setExpandedShiftId(null);
      setRequestsByShift((m) => {
        const next = { ...m };
        delete next[s.id];
        return next;
      });
      const reqs = requestsByShift[s.id] ?? [];
      if (reqs.length > 0) {
        setDraftNumber((d) => {
          const next = { ...d };
          for (const r of reqs) delete next[r.id];
          return next;
        });
      }
      await loadShifts();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Не удалось удалить смену");
    } finally {
      setShiftDeleteLoading(false);
    }
  };

  return (
    <section className="admin-shifts-section" aria-labelledby="admin-shifts-heading">
      <h3 id="admin-shifts-heading" className="admin-shifts-title">
        Все смены
      </h3>
      <div className="admin-shifts-panel">
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Сотрудник</th>
              <th>Открыта</th>
              <th>Закрыта</th>
              <th>Закрыл</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.id}</td>
                  <td>{s.employee_username}</td>
                  <td>{formatDateTimeInZone(s.opened_at, timezone)}</td>
                  <td>{formatDateTimeInZone(s.closed_at, timezone)}</td>
                  <td>{s.status === "closed" ? (s.closed_by_username ?? "—") : "—"}</td>
                  <td>{shiftStatusLabel(s.status)}</td>
                  <td>
                    <div className="admin-shift-actions">
                      <button type="button" onClick={() => void toggleRequests(s.id)}>
                        {expandedShiftId === s.id ? "Скрыть заявки" : "Заявки"}
                      </button>
                      {shiftDeleteConfirmId === s.id ? (
                        <div
                          className="admin-confirm-dialog"
                          role="dialog"
                          aria-labelledby={`delete-shift-title-${s.id}`}
                        >
                          <p id={`delete-shift-title-${s.id}`} className="admin-confirm-dialog-title">
                            Вы действительно хотите удалить смену?
                          </p>
                          <p className="admin-confirm-dialog-text">
                            Смена #{s.id} ({s.employee_username}). Все заявки и ковры будут удалены безвозвратно.
                          </p>
                          <div className="admin-confirm-dialog-actions">
                            <button
                              type="button"
                              disabled={shiftDeleteLoading}
                              onClick={() => void executeDeleteShift(s)}
                            >
                              {shiftDeleteLoading ? "…" : "Да, удалить"}
                            </button>
                            <button
                              type="button"
                              disabled={shiftDeleteLoading}
                              onClick={() => setShiftDeleteConfirmId(null)}
                            >
                              Отмена
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setShiftDeleteConfirmId(s.id)}>
                          Удалить смену
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedShiftId === s.id && (
                  <tr>
                    <td colSpan={7} className="admin-shifts-expand-cell">
                      <div className="admin-shifts-expand-inner">
                        {loadingShiftId === s.id ? (
                          <p>Загрузка…</p>
                        ) : (
                          <>
                            <div className="admin-shifts-expand-heading">Заявки смены #{s.id}</div>
                            <div className="admin-nested-table-wrap">
                              <div className="table-scroll">
                              <table className="data-table data-table--compact">
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>Номер заявки</th>
                                    <th>м²</th>
                                    <th>Ковров</th>
                                    <th>Действия</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(requestsByShift[s.id] ?? []).map((r) => (
                                    <Fragment key={r.id}>
                                      <tr>
                                        <td>{r.id}</td>
                                        <td>
                                          <input
                                            className="admin-request-number-input"
                                            value={draftNumber[r.id] ?? r.request_number}
                                            onChange={(e) =>
                                              setDraftNumber((d) => ({ ...d, [r.id]: e.target.value }))
                                            }
                                          />
                                        </td>
                                        <td>{r.total_area.toFixed(2)}</td>
                                        <td>{r.carpets.length}</td>
                                        <td>
                                          <div className="admin-request-actions">
                                            <button type="button" onClick={() => void saveRequestNumber(s.id, r.id)}>
                                              Сохранить номер
                                            </button>
                                            <button type="button" onClick={() => void deleteRequestRow(s.id, r)}>
                                              Удалить заявку
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td colSpan={5} className="admin-requests-carpet-cell">
                                          <div className="admin-carpet-block">
                                            <div className="admin-carpet-block-title">Ковры заявки #{r.id}</div>
                                            {r.carpets.length === 0 ? (
                                              <span className="admin-text-muted">Нет ковров</span>
                                            ) : (
                                              <div className="admin-nested-table-wrap">
                                              <div className="table-scroll">
                                                <table className="data-table data-table--compact">
                                                  <thead>
                                                    <tr>
                                                      <th>ID</th>
                                                      <th>Длина</th>
                                                      <th>Ширина</th>
                                                      <th>м²</th>
                                                      <th />
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {r.carpets.map((c) => (
                                                      <AdminCarpetRow
                                                        key={c.id}
                                                        carpet={c}
                                                        onReload={() => reloadRequestsForShift(s.id)}
                                                      />
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    </Fragment>
                                  ))}
                                </tbody>
                              </table>
                              </div>
                            </div>
                            {(requestsByShift[s.id] ?? []).length === 0 && !loadingShiftId && (
                              <p className="admin-shifts-empty">Нет заявок</p>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}
