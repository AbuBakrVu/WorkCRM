#!/usr/bin/env bash
# Мониторинг CRM: падение сервиса и нехватка места на диске → сообщение в Telegram.
# Запуск раз в 5 минут из cron на сервере:
#   */5 * * * * /opt/crm/scripts/monitor.sh
# Настройки — в /opt/crm/.monitor.env (рядом со скриптом; в git не попадает):
#   TG_TOKEN=123456:ABC...      # токен бота от @BotFather
#   TG_CHAT=123456789           # id чата (узнать у @userinfobot или в getUpdates)
#   CRM_URL=http://127.0.0.1:3000/api/health
#   DISK_PATH=/                 # какой раздел проверять
#   DISK_MIN_FREE_PCT=15        # предупреждать, когда свободно меньше N %
# Без TG_TOKEN скрипт только пишет в журнал (/tmp/crm-monitor.log).
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$HERE/.monitor.env" ] && . "$HERE/.monitor.env"
CRM_URL="${CRM_URL:-http://127.0.0.1:3000/api/health}"
DISK_PATH="${DISK_PATH:-/}"
DISK_MIN_FREE_PCT="${DISK_MIN_FREE_PCT:-15}"
STATE="${MONITOR_STATE:-/tmp/crm-monitor.state}"
LOG=/tmp/crm-monitor.log

notify() {
  echo "$(date '+%F %T') $1" >> "$LOG"
  [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT:-}" ] && curl -fsS -m 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=$1" >/dev/null 2>&1
  return 0
}
# Сообщаем только при смене состояния, чтобы не слать одно и то же каждые 5 минут
check() { # имя  ok|fail  текст-проблемы  текст-восстановления
  local prev; prev=$(grep "^$1=" "$STATE" 2>/dev/null | cut -d= -f2)
  if [ "$2" = fail ] && [ "$prev" != fail ]; then notify "🔴 CRM: $3"; fi
  if [ "$2" = ok ] && [ "$prev" = fail ]; then notify "🟢 CRM: $4"; fi
  { grep -v "^$1=" "$STATE" 2>/dev/null; echo "$1=$2"; } > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

# 1) сервис отвечает (две попытки, чтобы не пугаться перезапуска)
if curl -fsS -m 10 "$CRM_URL" >/dev/null 2>&1 || { sleep 20; curl -fsS -m 10 "$CRM_URL" >/dev/null 2>&1; }; then
  check up ok "" "сервис снова работает"
else
  check up fail "сервис не отвечает ($CRM_URL)" ""
fi

# 2) место на диске
used=$(df -P "$DISK_PATH" | awk 'NR==2 {gsub("%","",$5); print $5}')
free=$((100 - used))
if [ "$free" -lt "$DISK_MIN_FREE_PCT" ]; then
  check disk fail "на диске $DISK_PATH осталось ${free}% свободного места" ""
else
  check disk ok "" "места на диске достаточно (свободно ${free}%)"
fi
