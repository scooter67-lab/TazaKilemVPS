import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { authStore } from "../auth";
import { formatDateTimeInZone, formatUtcOffsetForZone } from "../dateFormat";
import { getUtcOffsetZoneChoices } from "../timezones";
import { useAppTimezone } from "../TimezoneContext";
import { User } from "../types";

const UTC_OFFSET_ZONE_CHOICES = getUtcOffsetZoneChoices();

function roleLabel(role: string): string {
  if (role === "Monitoring") return "Мониторинг";
  return role;
}

export function AdminPanel() {
  const { timezone, applyTimezone } = useAppTimezone();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * value селекта = реальная строка с сервера. Если это старая зона вроде Europe/Moscow,
   * сверху добавляем «Текущее: UTC±N» с value=Moscow — иначе при совпадении смещения с UTC+3
   * value был бы Etc/GMT-3 при том же визуальном выборе, и повторный клик по UTC+3 не вызывал бы onChange.
   */
  const offsetTick = Math.floor(now.getTime() / 60_000);
  const tzSelectOptions = useMemo(() => {
    const d = new Date();
    const base = UTC_OFFSET_ZONE_CHOICES;
    if (base.some((c) => c.iana === timezone)) return base;
    const off = formatUtcOffsetForZone(timezone, d);
    const head = [
      {
        label: off ? `Текущее: UTC${off}` : `Текущее: ${timezone}`,
        iana: timezone
      }
    ];
    return [...head, ...base];
  }, [timezone, offsetTick]);

  const [tzSaving, setTzSaving] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("User");

  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [userDeleteConfirmId, setUserDeleteConfirmId] = useState<number | null>(null);
  const [userDeleteLoading, setUserDeleteLoading] = useState(false);

  const load = async () => {
    setUsers(await api.users());
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!username || !password) return;
    await api.createUser(username, password, role);
    setUsername("");
    setPassword("");
    await load();
  };

  const toggleRole = async (u: User) => {
    const next = u.role === "User" ? "Monitoring" : u.role === "Monitoring" ? "Admin" : "User";
    await api.patchUser(u.id, { role: next });
    await load();
  };

  const setEmployeeActive = async (u: User, active: boolean) => {
    try {
      await api.patchUser(u.id, { is_active: active });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const currentAdminUserId = authStore.userId();
  const isSelfUser = (u: User) =>
    currentAdminUserId != null && Number(u.id) === Number(currentAdminUserId);
  const adminUsersCount = users.filter((x) => x.role === "Admin").length;
  const isLastAdmin = (u: User) => u.role === "Admin" && adminUsersCount <= 1;

  const executeDeleteUser = async (u: User) => {
    setUserDeleteLoading(true);
    try {
      await api.deleteUser(u.id);
      setUserDeleteConfirmId(null);
      setPasswordDrafts((d) => {
        const next = { ...d };
        delete next[u.id];
        return next;
      });
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Не удалось удалить пользователя");
    } finally {
      setUserDeleteLoading(false);
    }
  };

  const saveUserPassword = async (u: User) => {
    const pwd = (passwordDrafts[u.id] ?? "").trim();
    if (!pwd) {
      window.alert("Введите новый пароль");
      return;
    }
    try {
      await api.patchUser(u.id, { password: pwd });
      setPasswordDrafts((d) => ({ ...d, [u.id]: "" }));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Не удалось сохранить пароль");
    }
  };

  const previewUtcOffset = formatUtcOffsetForZone(timezone, now);

  return (
    <div className="stats-page">
      <h2 className="page-title">Админ-панель</h2>

      <section className="stats-section" aria-labelledby="admin-tz-heading">
        <h3 id="admin-tz-heading" className="stats-section-title">
          Часовой пояс
        </h3>
        <div className="stats-filters-card">
          <p className="admin-time-preview">
            Пример:{" "}
            <span className="admin-time-preview-mono">
              <b>
                {formatDateTimeInZone(now.toISOString(), timezone)}
                {previewUtcOffset ? ` (UTC${previewUtcOffset})` : ""}
              </b>
            </span>
          </p>
          <label className="stats-field-label">
            <span>Пояс для отображения времени</span>
            <select
              value={timezone}
              disabled={tzSaving}
              onChange={(e) => {
                const v = e.target.value;
                setTzSaving(true);
                applyTimezone(v)
                  .catch((err) =>
                    alert(err instanceof Error ? err.message : "Не удалось сохранить часовой пояс")
                  )
                  .finally(() => setTzSaving(false));
              }}
            >
              {tzSelectOptions.map(({ label, iana }) => (
                <option key={iana} value={iana}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="stats-section" aria-labelledby="admin-users-heading">
        <h3 id="admin-users-heading" className="stats-section-title">
          Пользователи
        </h3>
        <div className="stats-filters-card">
          <label className="stats-field-label">
            <span>Логин</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Логин" />
          </label>
          <label className="stats-field-label">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
            />
          </label>
          <label className="stats-field-label">
            <span>Роль</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="User">User</option>
              <option value="Monitoring">Мониторинг</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
          <div className="stats-actions-row">
            <button type="button" onClick={() => void create()}>
              Создать
            </button>
          </div>
        </div>

        <div className="admin-users-panel">
          <ul className="admin-users-list">
            {users.map((u) => (
              <li key={u.id} className="admin-user-row">
                <span style={{ flex: "1 1 200px" }}>
                  <b>{u.username}</b> ({roleLabel(u.role)})
                  {u.is_active === false && (
                    <span style={{ color: "crimson", marginLeft: 8 }}>уволен</span>
                  )}
                </span>
                <button type="button" onClick={() => toggleRole(u)} disabled={u.is_active === false}>
                  Сменить роль
                </button>
                {u.is_active !== false ? (
                  <button type="button" onClick={() => void setEmployeeActive(u, false)}>
                    Уволить
                  </button>
                ) : (
                  <button type="button" onClick={() => void setEmployeeActive(u, true)}>
                    Восстановить
                  </button>
                )}
                <input
                  className="admin-user-password-input"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDrafts[u.id] ?? ""}
                  onChange={(e) => setPasswordDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
                  placeholder="Новый пароль"
                  disabled={u.is_active === false}
                  aria-label={`Новый пароль для ${u.username}`}
                />
                <button
                  type="button"
                  disabled={u.is_active === false}
                  onClick={() => void saveUserPassword(u)}
                >
                  Сохранить пароль
                </button>
                {isSelfUser(u) ? (
                  <span className="admin-user-hint">Свою учётную запись удалить нельзя</span>
                ) : userDeleteConfirmId === u.id ? (
                  <div
                    className="admin-confirm-dialog"
                    role="dialog"
                    aria-labelledby={`delete-user-title-${u.id}`}
                    style={{ flex: "1 1 100%", maxWidth: "100%" }}
                  >
                    <p id={`delete-user-title-${u.id}`} className="admin-confirm-dialog-title">
                      Вы действительно хотите удалить пользователя?
                    </p>
                    <p className="admin-confirm-dialog-text">
                      <b>{u.username}</b> будет удалён безвозвратно вместе со всеми сменами, заявками и
                      коврами.
                    </p>
                    <div className="admin-confirm-dialog-actions">
                      <button
                        type="button"
                        disabled={userDeleteLoading}
                        onClick={() => void executeDeleteUser(u)}
                      >
                        {userDeleteLoading ? "…" : "Да, удалить"}
                      </button>
                      <button
                        type="button"
                        disabled={userDeleteLoading}
                        onClick={() => setUserDeleteConfirmId(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : isLastAdmin(u) ? (
                  <span className="admin-user-hint">Нельзя удалить последнего администратора</span>
                ) : (
                  <button type="button" onClick={() => setUserDeleteConfirmId(u.id)}>
                    Удалить пользователя
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
