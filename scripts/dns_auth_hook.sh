#!/usr/bin/env bash
# certbot manual auth hook: печатает TXT-значение и ждёт, пока запись появится
# в зоне. Нужен, потому что валидация HTTP/TLS с этой машины не проходит —
# часть проверяющих точек Let's Encrypt до неё не достукивается.
set -u

REC="_acme-challenge.${CERTBOT_DOMAIN}"

# certbot буферизует вывод хука до его завершения, поэтому дублируем токен
# в файл — иначе его не прочитать, пока хук ждёт запись.
printf '%s\t%s\n' "${REC}" "${CERTBOT_VALIDATION}" > /tmp/acme_txt_value

echo "=============================================="
echo "ДОБАВЬТЕ TXT-ЗАПИСЬ В ЗОНЕ tbgroup.kz (PS.kz):"
echo "  имя:      ${REC}"
echo "  тип:      TXT"
echo "  значение: ${CERTBOT_VALIDATION}"
echo "  TTL:      минимальный (60-300)"
echo "=============================================="

for i in $(seq 1 160); do
  for ns in 8.8.8.8 1.1.1.1; do
    if dig +short "TXT" "${REC}" "@${ns}" 2>/dev/null | tr -d '"' | grep -qF "${CERTBOT_VALIDATION}"; then
      echo "[${i}] запись видна на ${ns} — жду распространения и продолжаю"
      sleep 20
      exit 0
    fi
  done
  echo "[${i}] записи ещё нет, жду..."
  sleep 15
done

echo "ОШИБКА: TXT-запись не появилась за 40 минут"
exit 1
