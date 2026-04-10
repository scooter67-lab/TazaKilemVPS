import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Carpet, RequestItem, Shift } from "../types";

function CarpetEditRow({
  carpet,
  onSaved,
  onDeleted
}: {
  carpet: Carpet;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [len, setLen] = useState(String(carpet.length));
  const [wid, setWid] = useState(String(carpet.width));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLen(String(carpet.length));
    setWid(String(carpet.width));
  }, [carpet.id, carpet.length, carpet.width]);

  const save = async () => {
    const lengthNum = Number(len);
    const widthNum = Number(wid);
    if (Number.isNaN(lengthNum) || Number.isNaN(widthNum) || lengthNum <= 0 || widthNum <= 0) {
      return;
    }
    setSaving(true);
    try {
      await api.updateCarpet(carpet.id, lengthNum, widthNum);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Удалить этот ковёр?")) return;
    await api.deleteCarpet(carpet.id);
    await onDeleted();
  };

  return (
    <tr>
      <td>{carpet.id}</td>
      <td>
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={len}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setLen(e.target.value)}
          style={{ width: "100%", maxWidth: 120 }}
        />
      </td>
      <td>
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={wid}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setWid(e.target.value)}
          style={{ width: "100%", maxWidth: 120 }}
        />
      </td>
      <td>{carpet.area.toFixed(2)}</td>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 120 }}>
          <button type="button" disabled={saving} onClick={save}>
            {saving ? "…" : "Сохранить"}
          </button>
          <button type="button" onClick={remove}>
            Удалить
          </button>
        </div>
      </td>
    </tr>
  );
}

export function RequestPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [shift, setShift] = useState<Shift | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [length, setLength] = useState("1");
  const [width, setWidth] = useState("1");

  const load = async () => {
    const s = await api.currentShift();
    setShift(s);
    if (!s) return;
    const list = await api.shiftRequests(s.id);
    setRequests(list);
    const raw = searchParams.get("requestId");
    const queryRequestId = raw != null && raw !== "" ? Number(raw) : NaN;
    if (!Number.isNaN(queryRequestId) && list.some((item) => item.id === queryRequestId)) {
      setCurrent(queryRequestId);
      return;
    }
    setCurrent(null);
  };

  useEffect(() => {
    load();
  }, [searchParams]);

  const selected = requests.find((r) => r.id === current) ?? null;
  const total = useMemo(() => selected?.total_area ?? 0, [selected]);

  const addCarpet = async () => {
    if (!selected) return;
    const lengthNum = Number(length);
    const widthNum = Number(width);
    if (lengthNum <= 0 || widthNum <= 0) return;
    await api.addCarpet(selected.id, lengthNum, widthNum);
    await load();
  };

  if (!shift) return <p>Сначала откройте смену</p>;

  const openRequest = (requestId: number) => {
    navigate(`/request?requestId=${requestId}`);
  };

  const exitRequest = () => {
    navigate("/shift", { replace: true });
  };

  return (
    <div>
      <h2 className="page-title">Заявка</h2>
      <div className="request-tabs">
        {requests.map((r) => (
          <button key={r.id} type="button" onClick={() => openRequest(r.id)}>
            {r.id === current ? "▶ " : ""}
            {r.request_number}
          </button>
        ))}
      </div>
      <hr />
      {selected ? (
        <>
          <h3 style={{ fontSize: "clamp(1.1rem, 3.5vw, 1.25rem)" }}>Заявка: {selected.request_number}</h3>
          <div className="form-row">
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={length}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setLength(e.target.value)}
              placeholder="Длина"
            />
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={width}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="Ширина"
            />
            <button type="button" onClick={addCarpet}>
              Добавить ковер
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Длина</th>
                  <th>Ширина</th>
                  <th>Площадь</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.carpets.map((c) => (
                  <CarpetEditRow key={c.id} carpet={c} onSaved={load} onDeleted={load} />
                ))}
              </tbody>
            </table>
          </div>
          <p>Итого по заявке: {total.toFixed(2)} м²</p>
          <p>
            <button type="button" onClick={exitRequest}>
              Выйти из заявки
            </button>
          </p>
        </>
      ) : (
        <p>Выберите заявку</p>
      )}
    </div>
  );
}
