import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { authStore } from "./auth";

const DEFAULT_TZ = "UTC";

type Ctx = {
  timezone: string;
  refresh: () => Promise<void>;
  /** Сразу меняет пояс в UI и сохраняет на сервере (только для админа / при наличии токена) */
  applyTimezone: (tz: string) => Promise<void>;
};

const TimezoneContext = createContext<Ctx>({
  timezone: DEFAULT_TZ,
  refresh: async () => {},
  applyTimezone: async () => {}
});

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezone] = useState(DEFAULT_TZ);

  const refresh = useCallback(async () => {
    if (!authStore.access()) {
      setTimezone(DEFAULT_TZ);
      return;
    }
    try {
      const s = await api.getSettings();
      setTimezone(s.timezone);
    } catch {
      setTimezone(DEFAULT_TZ);
    }
  }, []);

  const applyTimezone = useCallback(
    async (tz: string) => {
      if (!authStore.access()) {
        throw new Error("Нет access-токена — войдите снова.");
      }
      setTimezone(tz);
      try {
        await api.patchSettings({ timezone: tz });
      } catch (e) {
        await refresh();
        throw e;
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ timezone, refresh, applyTimezone }),
    [timezone, refresh, applyTimezone]
  );

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
}

export function useAppTimezone() {
  return useContext(TimezoneContext);
}
