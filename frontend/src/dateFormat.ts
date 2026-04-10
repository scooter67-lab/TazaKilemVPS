/**
 * Момент времени с API: сервер хранит UTC без tzinfo и отдаёт ISO без суффикса (например 2026-04-10T14:30:00).
 * В ECMAScript такая строка считается локальным временем; для согласованности с часами в выбранном поясе
 * трактуем её как UTC (как если бы было …Z).
 */
export function parseApiInstantUtc(iso: string): Date {
  const s = iso.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    return new Date(s);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    return new Date(`${s}Z`);
  }
  return new Date(s);
}

/** «YYYY-MM-DD» → «дд.мм.гггг» для отображения */
export function isoDateToDmY(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * Строка «дд.мм.гггг» (или дд/мм/гггг) → «YYYY-MM-DD» для API.
 * Проверка календаря без сдвига по часовым поясам.
 */
export function parseDmYToIsoDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(year, month, 0).getDate();
  if (day > lastDay) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Дата дд:мм:год в заданном IANA-поясе */
export function formatDateDmYInZone(iso: string, timeZone: string): string {
  const d = parseApiInstantUtc(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  return `${day}:${month}:${year}`;
}

/** Время ЧЧ:ММ (24 ч) в заданном поясе */
export function formatTime24InZone(iso: string, timeZone: string): string {
  const d = parseApiInstantUtc(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

/** Время ЧЧ:ММ:СС (24 ч) в заданном поясе — для живых часов */
export function formatTime24SecondsInZone(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? parseApiInstantUtc(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const s = parts.find((p) => p.type === "second")?.value ?? "00";
  return `${h}:${m}:${s}`;
}

/** Дата и время одной строкой (как toLocaleString, но с поясом) */
export function formatDateTimeInZone(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return `${formatDateDmYInZone(iso, timeZone)} ${formatTime24InZone(iso, timeZone)}`;
}

/**
 * Смещение от UTC для IANA-зоны на заданный момент (учёт DST).
 * Примеры: "+3", "-5", "+5:30"
 */
export function formatUtcOffsetForZone(timeZone: string, date: Date = new Date()): string {
  const styles = ["longOffset", "shortOffset"] as const;
  for (const timeZoneName of styles) {
    try {
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName
      });
      const tzPart = dtf.formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
      if (!tzPart) continue;
      const m = tzPart.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
      if (m) {
        const sign = m[1];
        const hours = Number(m[2]);
        const minutes = m[3] != null ? Number(m[3]) : 0;
        if (minutes === 0) return `${sign}${hours}`;
        return `${sign}${hours}:${String(minutes).padStart(2, "0")}`;
      }
    } catch {
      continue;
    }
  }
  return "";
}
