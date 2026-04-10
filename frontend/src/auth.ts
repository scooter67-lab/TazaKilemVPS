const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
const ROLE_KEY = "role";
const USERNAME_KEY = "username";

/** JWT payload — base64url; `atob` ожидает base64 и ломается в Safari при части токенов. */
export function decodeJwtPayload<T extends Record<string, unknown> = Record<string, unknown>>(token: string): T | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (b64.length % 4)) % 4;
    const padded = b64 + "=".repeat(pad);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const authStore = {
  set(tokens: { access_token: string; refresh_token: string }, role: string, username?: string | null) {
    localStorage.setItem(ACCESS_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    localStorage.setItem(ROLE_KEY, role);
    if (username != null && username !== "") {
      localStorage.setItem(USERNAME_KEY, username);
    }
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY);
  },
  access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  role() {
    return localStorage.getItem(ROLE_KEY);
  },
  username() {
    return localStorage.getItem(USERNAME_KEY);
  },
  /** id из JWT sub (для UI, без лишнего запроса) */
  userId(): number | null {
    const t = localStorage.getItem(ACCESS_KEY);
    if (!t) return null;
    const payload = decodeJwtPayload<{ sub?: string }>(t);
    if (!payload) return null;
    const id = Number(payload.sub);
    return Number.isFinite(id) ? id : null;
  }
};
