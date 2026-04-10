const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
const ROLE_KEY = "role";
const USERNAME_KEY = "username";

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
    try {
      const parts = t.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(atob(parts[1])) as { sub?: string };
      const id = Number(payload.sub);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }
};
