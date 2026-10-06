#!/usr/bin/env bash
# Выкатка на прод: бэкап базы → сборка образа → перезапуск → проверка
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Резервная копия базы"
docker compose exec -T crm npm run backup 2>/dev/null || echo "  (контейнер не запущен — пропускаю бэкап)"

echo "→ Сборка и перезапуск"
docker compose up -d --build

echo "→ Проверка"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "✓ CRM работает ($(git rev-parse --short HEAD 2>/dev/null || echo 'без git'))"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done
echo "✗ Сервер не отвечает. Последние логи:"
docker compose logs --tail=60 crm
exit 1
