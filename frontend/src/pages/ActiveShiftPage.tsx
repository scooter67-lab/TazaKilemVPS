import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { authStore } from "../auth";
import { RequestItem, Shift } from "../types";

export function ActiveShiftPage() {
  const navigate = useNavigate();
  const [shift, setShift] = useState<Shift | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [requestNumber, setRequestNumber] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [requestCreateError, setRequestCreateError] = useState("");
  const [closeShiftConfirmOpen, setCloseShiftConfirmOpen] = useState(false);
  const [closeShiftLoading, setCloseShiftLoading] = useState(false);

  const load = async () => {
    try {
      setLoadError("");
      const current = await api.currentShift();
      setShift(current);
      if (current) {
        const list = await api.shiftRequests(current.id);
        setRequestCreateError("");
        setRequests(list);
        setSelectedRequestId((prev) => {
          if (list.length === 0) return null;
          if (prev != null && list.some((x) => x.id === prev)) return prev;
          return list[0].id;
        });
      } else {
        setRequests([]);
        setSelectedRequestId(null);
        setCloseShiftConfirmOpen(false);
      }
    } catch (e) {
      setShift(null);
      setRequests([]);
      setSelectedRequestId(null);
      console.error(e);
      setLoadError(
        e instanceof Error ? e.message : "Не удалось загрузить данные смены"
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const total = useMemo(
    () => requests.reduce((acc, item) => acc + item.total_area, 0),
    [requests]
  );

  const openShift = async () => {
    try {
      await api.openShift();
      await load();
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : "Не удалось открыть смену. Убедитесь, что backend запущен из папки backend: uvicorn app.main:app --reload"
      );
    }
  };

  const performCloseShift = async () => {
    setCloseShiftLoading(true);
    try {
      await api.closeShift();
      setCloseShiftConfirmOpen(false);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Не удалось закрыть смену");
    } finally {
      setCloseShiftLoading(false);
    }
  };

  const duplicateRequestMessage = "Такая заявка уже есть. Введите новый номер заявки.";

  const createRequest = async () => {
    if (!shift || !requestNumber.trim()) return;
    const num = requestNumber.trim();
    setRequestCreateError("");
    const sameNumber = (a: string, b: string) => a.trim() === b.trim();
    if (requests.some((r) => sameNumber(r.request_number, num))) {
      setRequestCreateError(duplicateRequestMessage);
      window.alert(duplicateRequestMessage);
      return;
    }
    try {
      const created = await api.createRequest(shift.id, num);
      setRequestNumber("");
      setRequestCreateError("");
      await load();
      navigate(`/request?requestId=${created.id}`);
    } catch (e) {
      const msg =
        e instanceof Error && e.message.trim()
          ? e.message
          : "Не удалось создать заявку";
      setRequestCreateError(msg);
      window.alert(msg);
    }
  };

  const removeRequest = async (r: RequestItem) => {
    if (!confirm(`Удалить заявку «${r.request_number}» и все ковры в ней?`)) return;
    try {
      await api.deleteRequest(r.id);
      if (selectedRequestId === r.id) setSelectedRequestId(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось удалить заявку");
    }
  };

  return (
    <div>
      <h2 className="page-title">Смена</h2>
      {authStore.username() && <p className="subtitle">Вы вошли как {authStore.username()}</p>}
      {loadError && (
        <div style={{ color: "crimson", marginBottom: 12, fontSize: 14 }}>
          <p style={{ margin: "0 0 8px" }}>{loadError}</p>
          <p style={{ margin: 0, color: "#333" }}>
            Запустите API из каталога <code>backend</code>:{" "}
            <code>python -m uvicorn app.main:app --reload</code>
            <br />
            Ошибка <code>ModuleNotFoundError: No module named &apos;app&apos;</code> значит, что команда
            запущена не из папки <code>backend</code>.
          </p>
        </div>
      )}
      {!shift ? (
        <button type="button" onClick={openShift}>
          Открыть смену
        </button>
      ) : (
        <>
          <p style={{ fontSize: 16 }}>Смена #{shift.id} ({shift.status})</p>
          <hr />
          <div className="form-row" style={{ alignItems: "stretch" }}>
            <input
              style={{ flex: "1 1 200px" }}
              value={requestNumber}
              onChange={(e) => {
                setRequestNumber(e.target.value);
                setRequestCreateError("");
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void createRequest();
              }}
              placeholder="Номер заявки"
              enterKeyHint="done"
              aria-invalid={requestCreateError ? true : undefined}
              aria-describedby={requestCreateError ? "request-create-error" : undefined}
            />
            <button type="button" onClick={() => void createRequest()}>
              Создать заявку
            </button>
          </div>
          {requestCreateError ? (
            <p
              id="request-create-error"
              role="alert"
              style={{ color: "crimson", marginTop: 10, marginBottom: 0, fontSize: 15 }}
            >
              {requestCreateError}
            </p>
          ) : null}
          <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {requests.map((r) => (
              <li key={r.id} className="shift-request-item">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRequestId(r.id);
                    navigate(`/request?requestId=${r.id}`);
                  }}
                >
                  {r.id === selectedRequestId ? "▶ " : ""}
                  Заявка {r.request_number} ({r.total_area.toFixed(2)} м²)
                </button>
                {shift.status === "active" && (
                  <button type="button" onClick={() => removeRequest(r)}>
                    Удалить
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p>Итого по смене: {total.toFixed(2)} м²</p>
          {shift.status === "active" && (
            <div style={{ marginTop: 12 }}>
              {!closeShiftConfirmOpen ? (
                <button type="button" onClick={() => setCloseShiftConfirmOpen(true)}>
                  Закрыть смену
                </button>
              ) : (
                <div
                  role="dialog"
                  aria-labelledby="close-shift-confirm-title"
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 10,
                    padding: 14,
                    maxWidth: 420,
                    background: "#fafafa"
                  }}
                >
                  <p
                    id="close-shift-confirm-title"
                    style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 16 }}
                  >
                    Вы действительно хотите закрыть смену?
                  </p>
                  <p style={{ margin: "0 0 14px", fontSize: 14, color: "#555", lineHeight: 1.4 }}>
                    После закрытия редактирование смены и заявок будет невозможно.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <button
                      type="button"
                      disabled={closeShiftLoading}
                      onClick={() => void performCloseShift()}
                    >
                      {closeShiftLoading ? "…" : "Да, закрыть"}
                    </button>
                    <button
                      type="button"
                      disabled={closeShiftLoading}
                      onClick={() => setCloseShiftConfirmOpen(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
