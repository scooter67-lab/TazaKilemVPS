import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Полоска внизу экрана: сообщает об отсутствии сети и предлагает поставить
 * новую версию. Обновляемся только по кнопке — перезагрузка посреди
 * заполнения смены потеряла бы введённое.
 */
export function PwaUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW();

  // navigator.onLine врёт при wi-fi без интернета, поэтому это подсказка,
  // а не диагноз: ошибки запросов страницы показывают сами.
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (offline) {
    return (
      <div className="pwa-toast pwa-toast--offline" role="status">
        <span>Нет сети — данные не обновляются</span>
      </div>
    );
  }

  if (!needRefresh) return null;

  return (
    <div className="pwa-toast" role="status">
      <span>Доступна новая версия</span>
      <div className="pwa-toast-actions">
        <button type="button" className="pwa-toast-btn" onClick={() => void updateServiceWorker(true)}>
          Обновить
        </button>
        <button type="button" className="pwa-toast-btn pwa-toast-btn--ghost" onClick={() => setNeedRefresh(false)}>
          Позже
        </button>
      </div>
    </div>
  );
}
