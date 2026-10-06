# CRM — инструкция для Claude Code

Рабочая CRM IT-команды: проекты/задачи (таблица, канбан, Гант), IT-заявки с SLA, клиенты и воронка сделок, учёт времени, финансы, дашборд.
Интерфейс и все тексты — **на русском**. Общение с владельцем — на русском, кратко и по делу.

## ВАЖНО: это боевой сервер
- Приложение работает в Docker (`docker compose`), данные — в `./data/crm.db` (SQLite). **Никогда не удаляй и не перезаписывай `./data`**, не запускай `npm run seed -- --force` здесь.
- Перед любой правкой схемы БД или массовыми изменениями — резервная копия: `docker compose exec -T crm npm run backup`.
- Изменения выкатываются только через `./deploy.sh` (бэкап → сборка → перезапуск → проверка health). Если health не прошёл — смотри `docker compose logs --tail=100 crm` и откатывай: `git checkout <прошлый коммит> && ./deploy.sh`.
- Каждое законченное изменение — отдельный git-коммит с понятным сообщением на русском.

## Стек
- `server/` — Node.js 22 (ESM), Express 5, встроенный `node:sqlite` (`DatabaseSync`), JWT в httpOnly-cookie, bcryptjs. Без ORM.
- `client/` — React 19 + Vite + Tailwind 4, react-router, lucide-react (иконки), recharts (графики). Сборка кладётся в `server/public`.

## Команды
```bash
# разработка (горячая перезагрузка), НЕ трогает боевой контейнер:
cd server && DATA_DIR=./dev-data PORT=3001 npm run dev      # API на :3001 с отдельной тестовой базой
cd server && DATA_DIR=./dev-data npm run seed                 # демо-данные в тестовую базу
cd client && VITE_API=http://localhost:3001 npm run dev       # UI на :5173 (прокси /api → VITE_API)
cd client && npm run build                                    # проверка, что фронт собирается

./deploy.sh                                                   # выкатить на прод
docker compose logs -f crm                                    # логи прода
docker compose exec -T crm npm run backup                     # бэкап прода
```

## Устройство кода
- `server/src/db.js` — схема (CREATE TABLE IF NOT EXISTS) + **миграции** (массив `MIGRATIONS`, версия в `PRAGMA user_version`).
  Новую колонку/таблицу для существующей базы добавляй ТОЛЬКО новой миграцией в конец массива; старые миграции не редактируй. Заодно допиши её в CREATE TABLE для новых установок (с `IF NOT EXISTS` это безопасно).
  SQLite `LIKE` не понимает регистр кириллицы — для поиска используй функцию `ulower()`.
- `server/src/routes.js` — весь REST API под `/api`. Хелперы: `wrap` (ошибки → JSON), `pick(body, FIELDS)` (белый список полей — новые поля добавляй в соответствующий `*_FIELDS`), `insert/update`, `logActivity`. Права: `requireRole('admin','manager')`.
- `server/src/auth.js` — сессии, роли `admin | manager | member`.
- `client/src/lib/` — `api.js` (fetch-обёртка), `store.jsx` (контекст: user, users, clients, projects, таймер, `toast`, `bump()` — перезагрузить данные после изменения, `useLoad(url)`), `format.js` (даты/деньги/длительности, `parseDate` для дат SQLite в UTC), `constants.js` (статусы, приоритеты, цвета, подписи).
- `client/src/components/ui.jsx` — UI-кит (Button, Modal, Drawer, Popover, Select, Field, StatusDot, Progress, AvatarStack, Stat…). Новые экраны собирай из него.
- `client/src/pages/*` — страницы. Маршруты — `client/src/App.jsx`, меню — `NAV` в `components/Layout.jsx`.

## Стиль
- Дизайн: светлый, белые карточки `rounded-2xl border-line`, кнопки-«пилюли» (`.chip`), акцент — зелёный `brand` (главные действия) и фиолетовый `violet` (таймер, фокус). Токены цветов — в `client/src/index.css` (`@theme`).
- Даты в БД: дни — `YYYY-MM-DD`, моменты времени — ISO UTC. На клиенте форматируй через `format.js`, «сегодня» — `todayStr()`, не `toISOString().slice(0,10)` (сдвиг часового пояса, сервер в UTC, пользователи в МСК).
- Деньги — рубли, `fmtMoney` / `fmtMoneyShort`.

## Проверка перед деплоем
1. `cd client && npm run build` — без ошибок.
2. Сервер стартует на тестовой базе и `curl localhost:3001/api/health` отвечает `{"ok":true}`.
3. Затронутый сценарий проверен руками (или через curl по API).
