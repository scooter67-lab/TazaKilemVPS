import { authStore, decodeJwtPayload } from "./auth";
import {
  ActiveShiftDashboardRow,
  AppSettings,
  Journal,
  RequestItem,
  Shift,
  ShiftAdmin,
  RequestStatRow,
  Stats,
  User
} from "./types";

const _envUrl = import.meta.env.VITE_API_URL;
const API_URL =
  typeof _envUrl === "string" && _envUrl.trim() !== ""
    ? _envUrl.trim().replace(/\/$/, "")
    : "http://127.0.0.1:8000";

function parseApiErrorBody(text: string): string {
  const raw = text.trim();
  if (!raw) return "";
  try {
    const j = JSON.parse(raw) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      const parts = d.map((x: unknown) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object" && "msg" in x && typeof (x as { msg: unknown }).msg === "string") {
          return (x as { msg: string }).msg;
        }
        return JSON.stringify(x);
      });
      return parts.filter(Boolean).join("; ");
    }
    if (d && typeof d === "object" && "msg" in d && typeof (d as { msg: unknown }).msg === "string") {
      return (d as { msg: string }).msg;
    }
    if (d != null) return String(d);
  } catch {
    /* not JSON */
  }
  return raw;
}

/** Роль из access JWT (после /refresh сервер не отдаёт role отдельным полем). */
function roleFromAccessToken(access: string): string {
  const payload = decodeJwtPayload<{ role?: string }>(access);
  if (payload && typeof payload.role === "string") return payload.role;
  return authStore.role() ?? "User";
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const rt = authStore.refresh();
    if (!rt) return false;
    const res = await fetch(`${API_URL}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt })
    });
    if (!res.ok) {
      authStore.clear();
      return false;
    }
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    authStore.set(data, roleFromAccessToken(data.access_token));
    return true;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const skipRefresh = path === "/login" || path === "/refresh";
  const token = authStore.access();
  const headers = new Headers(options.headers);
  const hasBody = options.body != null && options.body !== "";
  if (hasBody) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && !retried && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(path, options, true);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    const parsed = parseApiErrorBody(text);
    const msg =
      parsed.trim() ||
      (res.status === 400 ? "Некорректный запрос" : `Ошибка сервера (${res.status})`);
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  login(username: string, password: string) {
    return request<{ access_token: string; refresh_token: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },
  meRole() {
    return authStore.role() ?? "User";
  },
  openShift() {
    return request<Shift>("/shifts/open", { method: "POST" });
  },
  closeShift() {
    return request<Shift>("/shifts/close", { method: "POST" });
  },
  currentShift() {
    return request<Shift | null>("/shifts/current");
  },
  activeDashboardShifts() {
    return request<ActiveShiftDashboardRow[]>("/shifts/active-dashboard");
  },
  shiftRequests(shiftId: number) {
    return request<RequestItem[]>(`/requests/${shiftId}`);
  },
  createRequest(shift_id: number, request_number: string) {
    return request<RequestItem>("/requests", {
      method: "POST",
      body: JSON.stringify({ shift_id, request_number })
    });
  },
  updateRequest(id: number, request_number: string) {
    return request<RequestItem>(`/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ request_number })
    });
  },
  deleteRequest(id: number) {
    return request<{ ok: boolean }>(`/requests/${id}`, { method: "DELETE" });
  },
  addCarpet(request_id: number, length: number, width: number) {
    return request("/carpets", {
      method: "POST",
      body: JSON.stringify({ request_id, length, width })
    });
  },
  updateCarpet(id: number, length: number, width: number) {
    return request(`/carpets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ length, width })
    });
  },
  deleteCarpet(id: number) {
    return request(`/carpets/${id}`, { method: "DELETE" });
  },
  journals() {
    return request<Journal[]>("/journals");
  },
  users() {
    return request<User[]>("/users");
  },
  createUser(username: string, password: string, role: string) {
    return request("/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role })
    });
  },
  patchUser(id: number, body: { role?: string; is_active?: boolean; password?: string }) {
    return request<User>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  deleteUser(id: number) {
    return request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" });
  },
  shifts() {
    return request<ShiftAdmin[]>("/shifts");
  },
  deleteShift(shiftId: number) {
    return request<{ ok: boolean }>(`/shifts/${shiftId}`, { method: "DELETE" });
  },
  stats(params?: { userId?: number; dateFrom?: string; dateTo?: string }) {
    const sp = new URLSearchParams();
    if (params?.userId != null) sp.set("user_id", String(params.userId));
    if (params?.dateFrom) sp.set("date_from", params.dateFrom);
    if (params?.dateTo) sp.set("date_to", params.dateTo);
    const q = sp.toString();
    return request<Stats>(q ? `/stats?${q}` : "/stats");
  },
  statsRequests(params?: { userId?: number; dateFrom?: string; dateTo?: string }) {
    const sp = new URLSearchParams();
    if (params?.userId != null) sp.set("user_id", String(params.userId));
    if (params?.dateFrom) sp.set("date_from", params.dateFrom);
    if (params?.dateTo) sp.set("date_to", params.dateTo);
    const q = sp.toString();
    return request<RequestStatRow[]>(q ? `/stats/requests?${q}` : "/stats/requests");
  },
  getSettings() {
    return request<AppSettings>("/settings");
  },
  patchSettings(payload: { timezone: string }) {
    return request<AppSettings>("/settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }
};
