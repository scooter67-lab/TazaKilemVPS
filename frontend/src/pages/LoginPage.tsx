import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { authStore, decodeJwtPayload } from "../auth";
import { useAppTimezone } from "../TimezoneContext";

export function LoginPage() {
  const { refresh: refreshTimezone } = useAppTimezone();
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const tokens = await api.login(username, password);
      const jwt = decodeJwtPayload<{ role?: string }>(tokens.access_token);
      authStore.set(tokens, jwt?.role ?? "User", username);
      await refreshTimezone();
      nav("/");
    } catch (e) {
      const network =
        e instanceof TypeError ||
        (e instanceof Error && /failed to fetch|load failed|networkerror/i.test(e.message));
      setError(
        network
          ? "Нет связи с API. В Vercel → Environment Variables задайте VITE_API_URL: публичный HTTPS-адрес бэкенда (FastAPI в интернете). Это не адрес сайта на vercel.app и не localhost."
          : "Неверный логин или пароль"
      );
    }
  };

  return (
    <div className="login-page">
      <form className="form-stack" onSubmit={onSubmit}>
        <h2 className="page-title">Вход</h2>
        <p className="subtitle" style={{ lineHeight: 1.45 }}>
          Каждый сотрудник входит под <b>своим логином</b> — у каждого своя открытая смена, несколько человек могут
          работать одновременно (с разных устройств или браузеров).
        </p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Логин"
          autoComplete="username"
          enterKeyHint="next"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          autoComplete="current-password"
          enterKeyHint="go"
        />
        <button type="submit">Войти</button>
        {error && <p style={{ color: "crimson", margin: 0 }}>{error}</p>}
      </form>
      <p className="login-copyright">© 2026 Разработано TB Group</p>
    </div>
  );
}
