# CRM — инструкция для Claude Code

Рабочая CRM IT-команды: проекты = обслуживаемые организации (Минфин, СДЭК, университет…), внутри — задачи (название + описание обязательны), фильтр задач по статусу; канбан, Гант, IT-заявки с SLA, клиенты и воронка сделок, учёт времени, финансы, дашборд.
Интерфейс и все тексты — **на русском**. Общение с владельцем — на русском, кратко и по делу.

## Как устроена работа
- Claude Code работает **на компьютере владельца** (локальная копия репозитория). Боевой сервер (https://crm.bakr.pro) здесь недоступен и не трогается.
- Порядок: правка → проверка локально → коммит → `git push` в `main`. Владелец сам обновляет сервер (`git pull && ./deploy.sh` на VPS) и проверяет.
- **Не запускай** `./deploy.sh`, `./install.sh`, `docker compose` — это команды для сервера.
- Каждое законченное изменение — отдельный коммит с понятным сообщением на русском. Перед `git push` покажи владельцу, что изменилось (кратко, списком), и пушь после его «ок», если он не просил пушить сразу.
- Перед работой: `git pull`, чтобы не разойтись с GitHub.
- Схема БД на сервере обновляется сама при запуске (миграции в `server/src/db.js`), поэтому любые изменения структуры — только новой миграцией (см. ниже). Данные на сервере терять нельзя.

## Проверка перед пушем
1. `cd client && npm run build` — без ошибок.
2. Сервер стартует на тестовой базе (`server/dev-data`) и `curl localhost:3001/api/health` отвечает `{"ok":true}`.
3. Затронутый сценарий проверен (в браузере на http://localhost:5173 или через curl по API).

## Стек
- `server/` — Node.js 22 (ESM), Express 5, встроенный `node:sqlite` (`DatabaseSync`), JWT в httpOnly-cookie, bcryptjs. Без ORM.
- `client/` — React 19 + Vite + Tailwind 4, react-router, lucide-react (иконки), recharts (графики). Сборка кладётся в `server/public`.

## Команды (локально)
```bash
# первый запуск
cd server && npm install && DATA_DIR=./dev-data npm run seed   # тестовая база с демо-данными (admin@demo.ru / demo12345)
cd client && npm install

# разработка (горячая перезагрузка) — два процесса
cd server && DATA_DIR=./dev-data PORT=3001 npm run dev          # API на :3001
cd client && VITE_API=http://localhost:3001 npm run dev         # UI на http://localhost:5173

cd client && npm run build                                      # проверка сборки
cd server && DATA_DIR=./dev-data npm run seed -- --force        # пересоздать тестовую базу
```

На сервере (делает владелец, не Claude Code): `cd /opt/crm && git pull && ./deploy.sh`.

## Устройство кода
- `server/src/db.js` — базовая схема v0 (CREATE TABLE IF NOT EXISTS — **не менять**) + **миграции** (массив `MIGRATIONS`, версия в `PRAGMA user_version`).
  Любая новая колонка/таблица/индекс — ТОЛЬКО новой миграцией в конец массива (миграции выполняются и на новых базах). Для колонок используй хелпер `addColumn(d, table, col, def)`. Старые миграции не редактируй.
  SQLite `LIKE` не понимает регистр кириллицы — для поиска используй функцию `ulower()`.
- `server/src/routes.js` — весь REST API под `/api`. Хелперы: `wrap` (ошибки → JSON), `pick(body, FIELDS)` (белый список полей — новые поля добавляй в соответствующий `*_FIELDS`), `insert/update`, `logActivity`. Права: `requireRole('admin','manager')`.
- `server/src/auth.js` — сессии, роли `admin | manager | member`; клиенты из личного кабинета — отдельная таблица `portal_users` (токен с `pid`), им доступны только `/api/portal/*`. Шифрование секретов базы знаний — `encryptSecret/decryptSecret`.
- `server/src/audit.js` — история изменений (пишется автоматически в `update()` для таблиц из `TRACKED`) и корзина: удаляй через `trashDelete(entity, table, id, title)` — снимок со всеми зависимыми строками, восстановление из «Настройки → Корзина».
- `server/src/recurrence.js` — расчёт дат повторения (задачи, счета); планировщик — `tick()` в `index.js` (каждые 10 минут).
- `server/src/docgen.js` — документы по шаблонам Word в стиле Битрикс24 (`{DocumentNumber}`, `{ProductsProductName}`, модификаторы `~W=Y`, картинки-метки печать/подпись/QR), PDF через LibreOffice (`soffice`, в Docker-образе), УПД — XML ФНС 5.03 (windows-1251). Шаблоны грузятся через «Настройки → Шаблоны документов» и в репозиторий не кладутся.
- `client/src/lib/` — `api.js` (fetch-обёртка), `store.jsx` (контекст: user, users, clients, projects, таймер, `toast`, `bump()` — перезагрузить данные после изменения, `useLoad(url)`), `format.js` (даты/деньги/длительности, `parseDate` для дат SQLite в UTC), `constants.js` (статусы, приоритеты, цвета, подписи).
- `client/src/components/ui.jsx` — UI-кит (Button, Modal, Drawer, Popover, Select, Field, StatusDot, Progress, AvatarStack, Stat…). Новые экраны собирай из него.
- `client/src/pages/*` — страницы. Маршруты — `client/src/App.jsx`, меню — `NAV` в `components/Layout.jsx`.
  Разделы-хабы (`components/Hub.jsx`): «Финансы» `/finance/:tab` (счета, доходы и расходы, отчёты), «ИТ-инфраструктура» `/infra/:tab` (оборудование, база знаний), «Настройки» `/settings/:tab` (профиль, команда, компании, шаблоны, каталог, интеграции, корзина). Календарь, учёт времени и повторяющиеся задачи/счета — вкладки «Проектов» (`/projects?view=…`). Старые адреса (`/invoices`, `/kb`, `/time`…) перенаправляются в `App.jsx` — не дублируй одну информацию в нескольких разделах.

## Стиль
- Дизайн: светлый, белые карточки `rounded-2xl border-line`, кнопки-«пилюли» (`.chip`), акцент — зелёный `brand` (главные действия) и фиолетовый `violet` (таймер, фокус). Токены цветов — в `client/src/index.css` (`@theme`).
- Даты в БД: дни — `YYYY-MM-DD`, моменты времени — ISO UTC. На клиенте форматируй через `format.js`, «сегодня» — `todayStr()`, не `toISOString().slice(0,10)` (сдвиг часового пояса, сервер в UTC, пользователи в МСК).
- Деньги — рубли, `fmtMoney` / `fmtMoneyShort`.
