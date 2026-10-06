#!/usr/bin/env bash
# Установка CRM на сервер: спрашивает домен и данные администратора, запускает в Docker.
# Повторный запуск безопасен: данные в ./data сохраняются, можно сбросить пароль администратора.
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
ask()  { local __v; read -r -p "$1" __v; printf '%s' "$__v"; }

bold "Установка CRM"
echo

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  err "Docker или docker compose не найден."
  ans=$(ask "Установить Docker официальным скриптом get.docker.com? [Y/n] ")
  if [[ "${ans,,}" =~ ^(|y|yes|д|да)$ ]]; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER" || true
    ok "Docker установлен"
  else
    err "Без Docker установка невозможна"; exit 1
  fi
fi
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi
compose() { $DOCKER compose "$@"; }

# ---------- Домен ----------
echo
bold "1. Адрес"
echo "Если у вас есть домен (A-запись указывает на этот сервер) — введите его, будет HTTPS."
echo "Оставьте пустым, чтобы открыть CRM по IP: http://IP:3000 (без HTTPS)."
DOMAIN=$(ask "Домен (например crm.example.ru): ")
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

if [[ -n "$DOMAIN" ]]; then
  BIND="127.0.0.1"; COOKIE_SECURE="true"
else
  BIND="0.0.0.0"; COOKIE_SECURE="false"
fi

# ---------- Администратор ----------
echo
bold "2. Учётная запись администратора"
ADMIN_NAME=$(ask "Имя: ")
while [[ -z "$ADMIN_NAME" ]]; do ADMIN_NAME=$(ask "Имя не может быть пустым. Имя: "); done

ADMIN_EMAIL=$(ask "Email (логин): ")
while ! [[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; do
  ADMIN_EMAIL=$(ask "Некорректный email. Email (логин): ")
done

while true; do
  read -r -s -p "Пароль (не короче 8 символов): " ADMIN_PASS; echo
  if (( ${#ADMIN_PASS} < 8 )); then err "Слишком короткий пароль"; continue; fi
  read -r -s -p "Повторите пароль: " ADMIN_PASS2; echo
  if [[ "$ADMIN_PASS" != "$ADMIN_PASS2" ]]; then err "Пароли не совпадают"; continue; fi
  break
done
unset ADMIN_PASS2

# ---------- .env и запуск ----------
echo
bold "3. Запуск"
cat > .env <<EOF
# Создано install.sh $(date '+%Y-%m-%d %H:%M')
BIND=$BIND
COOKIE_SECURE=$COOKIE_SECURE
DOMAIN=$DOMAIN
EOF
chmod 600 .env
mkdir -p data
# контейнер работает от пользователя node (uid 1000)
$DOCKER run --rm -v "$PWD/data:/data" alpine chown -R 1000:1000 /data >/dev/null 2>&1 || sudo chown -R 1000:1000 data

compose up -d --build

printf 'Ожидаю запуск'
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then echo; ok "Сервер запущен"; break; fi
  printf '.'; sleep 1
  if (( i == 60 )); then echo; err "Сервер не ответил. Логи:"; compose logs --tail=60 crm; exit 1; fi
done

printf '%s\n%s\n%s\n' "$ADMIN_NAME" "$ADMIN_EMAIL" "$ADMIN_PASS" | compose exec -T crm node --disable-warning=ExperimentalWarning src/create-admin.js
unset ADMIN_PASS

# ---------- HTTPS через Caddy ----------
if [[ -n "$DOMAIN" ]]; then
  echo
  bold "4. HTTPS"
  if ! command -v caddy >/dev/null 2>&1; then
    ans=$(ask "Установить Caddy (веб-сервер с автоматическим HTTPS)? [Y/n] ")
    if [[ "${ans,,}" =~ ^(|y|yes|д|да)$ ]]; then
      sudo apt-get update -qq && sudo apt-get install -y -qq caddy
    fi
  fi
  if command -v caddy >/dev/null 2>&1; then
    if sudo grep -q "^$DOMAIN" /etc/caddy/Caddyfile 2>/dev/null; then
      ok "Домен уже есть в /etc/caddy/Caddyfile"
    else
      printf '\n%s {\n\tencode gzip zstd\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
      sudo systemctl reload caddy || sudo systemctl restart caddy
      ok "Caddy настроен для $DOMAIN"
    fi
    URL="https://$DOMAIN"
  else
    err "Caddy не установлен — настройте HTTPS вручную (см. README). Пока CRM доступна только локально на 127.0.0.1:3000"
    URL="https://$DOMAIN (после настройки HTTPS)"
  fi
else
  IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  URL="http://$IP:3000"
fi

echo
bold "Готово!"
echo "  Адрес:  $URL"
echo "  Логин:  $ADMIN_EMAIL"
echo
echo "Обновление после правок кода:   ./deploy.sh"
echo "Сброс пароля администратора:    ./install.sh  (данные не пропадут)"
