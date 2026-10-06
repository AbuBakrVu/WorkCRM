// Демо-данные. Запуск: npm run seed  (только на пустой базе; --force очищает базу)
import { db, get, run, tx } from './db.js';
import { hashPassword } from './auth.js';

const force = process.argv.includes('--force');
if (get('SELECT COUNT(*) c FROM users').c > 0 && !force) {
  console.log('База не пустая — пропускаю. Для перезаписи: npm run seed -- --force');
  process.exit(0);
}

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const ins = (table, obj) => {
  const k = Object.keys(obj);
  return Number(run(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map((x) => obj[x] ?? null)).lastInsertRowid);
};
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pickOne = (a) => a[Math.floor(rnd() * a.length)];

tx(() => {
  if (force) for (const t of ['activity', 'transactions', 'time_entries', 'deals', 'ticket_comments', 'tickets', 'tasks', 'project_members', 'projects', 'clients', 'users'])
    db.exec(`DELETE FROM ${t}; DELETE FROM sqlite_sequence WHERE name='${t}';`);

  const pwd = hashPassword('demo12345');
  const users = [
    ['Администратор', 'admin@demo.ru', 'admin', 'Руководитель', '#4f46e5', 2500],
    ['Иса Хасанов', 'isa@demo.ru', 'manager', 'Руководитель проектов', '#0ea5e9', 2000],
    ['Мадина Алиева', 'madina@demo.ru', 'member', 'Сетевой инженер', '#ec4899', 1500],
    ['Руслан Умаров', 'ruslan@demo.ru', 'member', 'Системный администратор', '#f59e0b', 1500],
    ['Хеда Мусаева', 'kheda@demo.ru', 'member', 'Специалист поддержки', '#10b981', 1200],
    ['Ахмед Садулаев', 'akhmed@demo.ru', 'member', 'Инженер СКС и видеонаблюдения', '#8b5cf6', 1400],
  ].map(([name, email, role, position, color, hourly_rate]) => ins('users', { name, email, role, position, color, hourly_rate, password_hash: pwd }));

  const clients = [
    ['Технический университет', 'company', 'Проректор по ИТ', '+7 928 000-11-22', 'it@univer.example', 'Главный, учебные корпуса №1–5, общежития'],
    ['ООО «Альфа-Строй»', 'company', 'Заур Ибрагимов', '+7 928 111-22-33', 'office@alfa.example', 'Офис, 2 этажа, 40 рабочих мест'],
    ['Медцентр «Гиппократ»', 'company', 'Лейла Абдулаева', '+7 938 222-33-44', 'admin@med.example', 'Сеть из 3 филиалов'],
    ['Гимназия №7', 'company', 'Директор', '+7 8712 22-33-44', 'school7@edu.example', null],
    ['ТЦ «Гранд Парк»', 'company', 'Служба эксплуатации', '+7 928 333-44-55', 'tech@grand.example', 'Видеонаблюдение и Wi-Fi'],
    ['Внутренние задачи', 'internal', null, null, null, 'Инфраструктура компании'],
  ].map(([name, type, contact_name, phone, email, notes]) => ins('clients', { name, type, contact_name, phone, email, notes }));

  // Проект = обслуживаемая организация; внутри — задачи с описанием
  const P = [
    ['Технический университет', 0, [2, 3, 5], 'Обслуживание сети и серверов учебных корпусов №1–5 и общежитий.'],
    ['ООО «Альфа-Строй»', 1, [2, 3], 'Абонентское обслуживание офиса: 40 рабочих мест, АТС, сеть.'],
    ['Медцентр «Гиппократ»', 2, [3, 4], 'Три филиала: сеть, МИС, резервное копирование.'],
    ['Гимназия №7', 3, [4, 5], 'Компьютерные классы, Wi-Fi, видеонаблюдение.'],
    ['ТЦ «Гранд Парк»', 4, [5, 2], 'Видеонаблюдение, Wi-Fi для арендаторов, СКУД.'],
    ['Внутренние задачи', 5, [1, 3], 'Инфраструктура и процессы нашей компании.'],
  ];
  // [название, описание, статус, срок (дней от сегодня | null), создана (дней назад)]
  const TASKS = {
    0: [
      ['Схема сети корпуса №1', 'Снять схему L2/L3: коммутаторы, VLAN, аплинки. Результат — схема в draw.io и таблица портов.', 'done', -6, 18],
      ['Инвентаризация коммутаторов', 'Собрать модели, серийники, версии прошивок всех коммутаторов. Выгрузить в таблицу.', 'done', -3, 16],
      ['Проверить кабельные линии корпуса №3', 'Жалобы на обрывы на 2 этаже. Протестировать линии тестером, заменить патч-корды.', 'in_progress', 1, 6],
      ['Единая схема именования устройств', 'Предложить формат имён: корпус-этаж-тип-номер. Согласовать с отделом ИТ.', 'todo', 5, 4],
      ['Wi-Fi в общежитии №2', 'Радиообследование этажей, расчёт количества точек доступа, смета.', 'todo', -1, 10],
      ['Обновить прошивки ядра сети', 'Плановое обновление в выходные, согласовать окно работ.', 'todo', 12, 2],
    ],
    1: [
      ['Настроить АТС для нового отдела', 'Завести 6 внутренних номеров, настроить группу вызова и переадресацию.', 'done', -4, 12],
      ['Заменить ИБП в серверной', 'Батареи деградировали, автономия меньше 5 минут. Подобрать замену и установить.', 'in_progress', 2, 5],
      ['Подключить новый принтер', 'МФУ в бухгалтерию: драйверы, сканирование в папку, адресная книга.', 'todo', 3, 1],
    ],
    2: [
      ['Резервное копирование МИС', 'Ежедневный бэкап базы МИС на NAS + еженедельно в облако. Проверить восстановление.', 'done', -8, 20],
      ['VPN между филиалами', 'Объединить 3 филиала в единую сеть через WireGuard на роутерах.', 'in_progress', -2, 9],
      ['Сменить пароли Wi-Fi', 'Гостевая и служебная сети, разные пароли, гостевую изолировать.', 'todo', 4, 3],
    ],
    3: [
      ['Переустановить ПК в кабинете информатики', '15 ПК: чистая установка, образ с нужным ПО, учётки учеников.', 'in_progress', 6, 7],
      ['Камера у главного входа', 'Камера не пишет в архив. Проверить питание PoE и настройки регистратора.', 'todo', 0, 2],
    ],
    4: [
      ['Wi-Fi для арендаторов', 'Отдельная сеть с авторизацией по SMS, ограничение скорости.', 'in_progress', 9, 8],
      ['Ремонт камер парковки', 'Две камеры без изображения после грозы. Диагностика и замена.', 'done', -1, 6],
      ['Смета на СКУД', 'Обследовать 12 дверей, подобрать контроллеры и считыватели.', 'todo', 14, 1],
    ],
    5: [
      ['Мониторинг Zabbix', 'Поставить Zabbix, шаблоны для коммутаторов и серверов клиентов, оповещения в Telegram.', 'in_progress', 5, 11],
      ['Регламент выезда на заявки', 'Описать порядок: приём, выезд, отчёт, закрытие. Согласовать с командой.', 'todo', null, 3],
      ['Купить тестер кабельных линий', 'Сравнить 2–3 модели, согласовать бюджет.', 'done', -5, 9],
    ],
  };
  const projects = P.map(([name, ci, members, description], i) => {
    const id = ins('projects', { name, status: 'in_progress', client_id: clients[ci], owner_id: users[1], description });
    for (const m of [0, ...members]) run('INSERT OR IGNORE INTO project_members VALUES (?,?)', id, users[m]);
    (TASKS[i] || []).forEach(([title, description, status, due, ago], j) => {
      const created = new Date(Date.now() - ago * 864e5 - j * 3600e3);
      ins('tasks', { project_id: id, title, description, status, assignee_id: users[members[j % members.length]], position: j,
        due_date: due === null ? null : day(due), created_by: users[1],
        created_at: created.toISOString().replace('T', ' ').slice(0, 19),
        completed_at: status === 'done' ? new Date(Math.min(Date.now() - 3600e3, created.getTime() + (ago / 2) * 864e5)).toISOString() : null });
    });
    return id;
  });

  const cats = ['network', 'hardware', 'software', 'access', 'printer', 'other'];
  const T = [
    ['Нет интернета в ауд. 305', 'network', 'high', 'new', 'Корпус №3, ауд. 305', 'Кафедра физики'],
    ['Не печатает принтер в деканате', 'printer', 'normal', 'in_progress', 'Корпус №1, деканат ФИТ', 'Секретарь деканата'],
    ['Восстановить доступ к 1С', 'access', 'high', 'in_progress', 'Бухгалтерия', 'Главный бухгалтер'],
    ['Упал коммутатор на 2 этаже', 'network', 'critical', 'new', 'Корпус №2, этаж 2', 'Дежурный'],
    ['Установить ПО для лаборатории', 'software', 'low', 'waiting', 'Лабораторный корпус', 'Зав. лабораторией'],
    ['Шумит ИБП в серверной', 'hardware', 'normal', 'resolved', 'Серверная, главный корпус', 'Руслан Умаров'],
    ['Проектор не видит ноутбук', 'hardware', 'normal', 'closed', 'Актовый зал', 'Учебный отдел'],
    ['Новый сотрудник — учётная запись', 'access', 'normal', 'resolved', 'Отдел кадров', 'Отдел кадров'],
    ['Медленный Wi-Fi в библиотеке', 'network', 'normal', 'in_progress', 'Библиотека', 'Библиотекарь'],
    ['Замена картриджа', 'printer', 'low', 'new', 'Корпус №4, каб. 12', 'Методист'],
    ['Не работает камера у входа', 'hardware', 'high', 'waiting', 'ТЦ, вход Б', 'Служба эксплуатации'],
    ['Спам-рассылка с ящика', 'software', 'critical', 'resolved', 'Медцентр, филиал 2', 'Администратор'],
  ];
  const SLA = { critical: 4, high: 8, normal: 24, low: 72 };
  const tickets = T.map(([title, category, priority, status, location, requester], i) => {
    const created = new Date(Date.now() - (i * 7 + 2) * 3600e3 * (i % 3 + 1));
    const due = new Date(created.getTime() + SLA[priority] * 3600e3);
    const resolved = ['resolved', 'closed'].includes(status) ? new Date(created.getTime() + 3 * 3600e3).toISOString() : null;
    return ins('tickets', { title, category, priority, status, location, requester, client_id: clients[i % 5 === 2 ? 2 : i % 5 === 4 ? 4 : 0],
      assignee_id: status === 'new' ? null : users[[2, 3, 4, 5][i % 4]], created_by: users[4], created_at: created.toISOString().replace('T', ' ').slice(0, 19),
      due_at: due.toISOString(), resolved_at: resolved, description: 'Описание проблемы со слов заявителя.' });
  });
  ins('ticket_comments', { ticket_id: tickets[1], user_id: users[4], body: 'Выехала на место, проверяю драйвер.' });
  ins('ticket_comments', { ticket_id: tickets[2], user_id: users[3], body: 'Сбросил пароль, жду подтверждения от бухгалтерии.' });

  [
    ['Сеть для нового филиала', 2, 380000, 'proposal'], ['Видеонаблюдение склада', 1, 240000, 'qualified'],
    ['Wi-Fi в торговой галерее', 4, 560000, 'negotiation'], ['Обслуживание по договору (год)', 3, 360000, 'won'],
    ['Серверная для университета', 0, 2100000, 'lead'], ['Аутсорсинг ИТ для офиса', 1, 180000, 'lead'],
    ['Модернизация АТС', 2, 150000, 'lost'], ['СКУД для ТЦ', 4, 720000, 'proposal'],
  ].forEach(([title, ci, amount, stage], i) => ins('deals', { title, client_id: clients[ci], amount, stage, owner_id: users[1], expected_close: day(5 + i * 6), position: i }));

  // Учёт времени за последние 3 недели
  for (let d = -21; d <= -1; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    if ([0, 6].includes(dt.getDay())) continue;
    for (const u of [1, 2, 3, 4, 5]) {
      const n = 1 + Math.floor(rnd() * 3);
      let hour = 9;
      for (let k = 0; k < n; k++) {
        const pi = pickOne([0, 0, 1, 2, 3, 4, 5]);
        const start = new Date(dt); start.setHours(hour, Math.floor(rnd() * 30), 0, 0);
        const dur = Math.round((1 + rnd() * 2.5) * 3600);
        hour += Math.ceil(dur / 3600) + 1;
        const useTicket = u === 4 && rnd() > 0.4;
        ins('time_entries', { user_id: users[u], project_id: useTicket ? null : projects[pi], ticket_id: useTicket ? pickOne(tickets) : null,
          description: useTicket ? 'Работа по заявке' : 'Работы по проекту', started_at: start.toISOString(),
          ended_at: new Date(start.getTime() + dur * 1000).toISOString(), duration_sec: dur });
      }
    }
  }

  // Финансы за 6 месяцев
  for (let m = 5; m >= 0; m--) {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() - m);
    const ds = (d) => { const x = new Date(base); x.setDate(d); return x.toISOString().slice(0, 10); };
    const inc = [[ds(5), 'Оплата по договору', 0, 'Проекты'], [ds(15), 'Абонентское обслуживание', 3, 'Обслуживание'], [ds(22), 'Аванс по проекту', 4, 'Проекты']];
    const today = new Date().toISOString().slice(0, 10);
    inc.filter(([date]) => date <= today).forEach(([date, description, ci, category]) => ins('transactions', { type: 'income', amount: Math.round((250 + rnd() * 450) * 1000), category, date, description, client_id: clients[ci], project_id: projects[ci === 4 ? 4 : 0], created_by: users[0] }));
    [['Зарплата', 'ФОТ', 420000], ['Аренда офиса', 'Аренда', 85000], ['Закупка оборудования', 'Оборудование', 150000 + Math.round(rnd() * 200000)], ['Связь и хостинг', 'Связь', 12000]]
      .filter((_, j) => ds(3 + j * 6) <= today)
      .forEach(([description, category, amount], j) => ins('transactions', { type: 'expense', amount, category, date: ds(3 + j * 6), description, created_by: users[0] }));
  }

  const acts = [
    [1, 'project', projects[4], 'create', 'создал проект «ТЦ «Гранд Парк»»'],
    [2, 'task', null, 'done', 'закрыла задачу «Схема сети корпуса №1»'],
    [4, 'ticket', tickets[0], 'create', `создала заявку #${tickets[0]} «Нет интернета в ауд. 305»`],
    [3, 'ticket', tickets[5], 'status', `изменил статус заявки #${tickets[5]} → resolved`],
    [1, 'deal', null, 'stage', 'перевёл сделку «Обслуживание по договору (год)» на этап won'],
  ];
  acts.forEach(([u, entity, entity_id, action, text], i) => ins('activity', { user_id: users[u], entity, entity_id, action, text,
    created_at: new Date(Date.now() - (acts.length - i) * 47 * 60e3).toISOString().replace('T', ' ').slice(0, 19) }));
});

console.log('Демо-данные загружены. Вход: admin@demo.ru / demo12345');
