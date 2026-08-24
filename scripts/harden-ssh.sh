#!/usr/bin/env bash
# Закрывает вход по ssh паролем и вход под root, ставит fail2ban.
#
# Запускать на сервере под root:
#   ssh -t ilya@magazine.tbgroup.kz 'sudo bash -s' < scripts/harden-ssh.sh
#
# Почему drop-in называется 00-: sshd берёт ПЕРВОЕ вхождение каждого ключа, а
# Include стоит строкой 24 главного конфига — раньше строк 54/78/85, где уже
# написано `no`. Файлы из sshd_config.d читаются по алфавиту, поэтому побеждает
# самый ранний: 50-cloud-init.conf с `PasswordAuthentication yes`. Наш файл
# должен стоять перед ним, отсюда 00.
#
# Действующую сессию reload не разрывает, вход по ключу продолжает работать.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "нужен root: sudo bash -s < $0"; exit 1; }

DROPIN=/etc/ssh/sshd_config.d/00-hardening.conf
LEGACY=/etc/ssh/sshd_config.d/99-root-ssh.conf

echo "==> Как сервер отвечает сейчас"
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '

echo "==> Пишу $DROPIN"
cat >"$DROPIN" <<'CONF'
# Вход только по ключу. Файл назван 00-, чтобы читаться раньше остальных:
# в sshd выигрывает первое вхождение ключа, а не последнее.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
CONF
chmod 644 "$DROPIN"

# Файл, который и открыл пароль с root'ом. Убираем из выборки *.conf, но
# оставляем на диске — вдруг понадобится посмотреть, что там было.
if [ -f "$LEGACY" ]; then
  echo "==> Отключаю $LEGACY (переименование в .disabled)"
  mv "$LEGACY" "$LEGACY.disabled"
fi

echo "==> Проверка конфига до перезапуска"
if ! sshd -t; then
  echo "КОНФИГ БИТЫЙ — откатываюсь, ssh не трогаю"
  rm -f "$DROPIN"
  [ -f "$LEGACY.disabled" ] && mv "$LEGACY.disabled" "$LEGACY"
  exit 1
fi

echo "==> Перечитываю ssh"
# В Ubuntu ssh поднят через сокет: демон на каждое соединение читает конфиг
# заново, так что reload — формальность. Не срослось — не повод бросать прогон.
systemctl reload ssh 2>/dev/null ||
  systemctl reload sshd 2>/dev/null ||
  echo 'reload не прошёл; новые соединения всё равно читают конфиг заново'

echo "==> Как отвечает после"
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '

echo "==> fail2ban"
if ! command -v fail2ban-client >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban
fi
cat >/etc/fail2ban/jail.local <<'CONF'
[DEFAULT]
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
CONF
systemctl enable --now fail2ban
sleep 2
fail2ban-client status sshd || true

echo
echo "==> Готово. Вход по паролю и под root закрыт, fail2ban следит за ssh."
echo "    НЕ ЗАКРЫВАЙТЕ эту сессию, пока не проверите вход в другом окне:"
echo "        ssh ilya@magazine.tbgroup.kz"
