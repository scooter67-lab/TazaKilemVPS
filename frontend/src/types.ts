export type Role = "Admin" | "User" | "Monitoring";

export interface AppSettings {
  timezone: string;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  is_active: boolean;
}

export interface Shift {
  id: number;
  user_id: number;
  employee_username: string;
  opened_at: string;
  closed_at: string | null;
  status: "active" | "closed";
  closed_by_id?: number | null;
}

/** Ответ GET /shifts (админ): сотрудник и кто закрыл смену */
export interface ShiftAdmin {
  id: number;
  user_id: number;
  employee_username: string;
  opened_at: string;
  closed_at: string | null;
  status: "active" | "closed";
  closed_by_id: number | null;
  closed_by_username: string | null;
}

/** GET /shifts/active-dashboard */
export interface ActiveShiftDashboardRow {
  id: number;
  employee_username: string;
  opened_at: string;
  requests_count: number;
  carpets_count: number;
  total_area: number;
}

export interface Carpet {
  id: number;
  request_id: number;
  length: number;
  width: number;
  area: number;
}

export interface RequestItem {
  id: number;
  shift_id: number;
  request_number: string;
  carpets: Carpet[];
  total_area: number;
}

export interface Journal {
  shift_id: number;
  user: string;
  date: string;
  requests: RequestItem[];
  total_area: number;
}

export interface EmployeeStat {
  username: string;
  shifts: number;
  area: number;
}

export interface Stats {
  employees: EmployeeStat[];
  total_requests: number;
  total_area: number;
}

/** GET /stats/requests — заявки в выбранных фильтрах статистики */
export interface RequestStatRow {
  id: number;
  request_number: string;
  shift_id: number;
  employee_username: string;
  shift_opened_at: string;
  shift_closed_at: string | null;
  shift_status: string;
  carpets_count: number;
  total_area: number;
}
