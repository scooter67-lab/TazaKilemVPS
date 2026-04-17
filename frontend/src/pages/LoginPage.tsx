import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { authStore, decodeJwtPayload } from "../auth";
import { useAppTimezone } from "../TimezoneContext";

function IconEyeOpen() {
  return (
    <svg className="login-password-eye-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg className="login-password-eye-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M9.88 9.88a3 3 0 1 0 4.24 4.24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LoginPage() {
  const { refresh: refreshTimezone } = useAppTimezone();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="login-page-main">
        <form className="form-stack login-page-form" onSubmit={onSubmit}>
          <h2 className="page-title">Вход</h2>
          <input
            className="login-page-field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин"
            autoComplete="username"
            enterKeyHint="next"
          />
          <div className="login-password-wrap">
            <input
              className="login-password-input login-page-field"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="current-password"
              enterKeyHint="go"
              aria-label="Пароль"
            />
            <button
              type="button"
              className="login-password-eye"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? <IconEyeOff /> : <IconEyeOpen />}
            </button>
          </div>
          <button type="submit">Войти</button>
          {error && <p className="login-page-error">{error}</p>}
        </form>
      </div>
      <p className="login-copyright">© 2026 Разработано TB Group | Deploy test v1</p>
    </div>
  );
}
