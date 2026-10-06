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

  const P = [
    ['Аудит сети учебных корпусов', 'in_progress', 0, -20, 8, 450000, [2, 3, 5]],
    ['Мониторинг Zabbix для серверной', 'in_review', 0, -30, 3, 180000, [3, 4]],
    ['Wi-Fi в общежитии №2', 'stuck', 0, -15, 12, 620000, [2, 5]],
    ['Видеонаблюдение: 48 камер', 'in_progress', 4, -10, 20, 980000, [5, 1]],
    ['Офисная сеть и телефония', 'done', 1, -40, -5, 320000, [2, 3]],
    ['Резервное копирование 1С', 'done', 2, -25, -2, 140000, [3]],
    ['Обновление парка ПК (120 шт.)', 'planned', 3, 10, 45, 1450000, [3, 4]],
    ['Портал заявок для деканатов', 'in_progress', 0, -5, 35, 260000, [1, 4]],
    ['СКУД в лабораторном корпусе', 'planned', 0, 25, 60, 540000, [5, 2]],
    ['Миграция почты на новый сервер', 'in_progress', 5, -8, 6, 0, [3]],
  ];
  const TASKS = {
    0: ['Схема L2/L3 корпуса №1', 'Инвентаризация коммутаторов', 'Проверка кабельных линий корпуса №3', 'Единая схема именования', 'Отчёт и рекомендации'],
    1: ['Установка Zabbix-сервера', 'Шаблоны для коммутаторов', 'Оповещения в Telegram', 'Дашборд для руководства'],
    2: ['Радиообследование этажей', 'Заказ точек доступа', 'Монтаж 24 точек', 'Настройка контроллера', 'Гостевая сеть с авторизацией'],
    3: ['Проект размещения камер', 'Прокладка кабеля', 'Монтаж камер 1 этап', 'Монтаж камер 2 этап', 'Настройка видеорегистратора', 'Обучение охраны'],
    4: ['Монтаж стойки', 'Настройка АТС', 'Сдача объекта'],
    5: ['Скрипт резервного копирования', 'Проверка восстановления'],
    6: ['Спецификация оборудования', 'Согласование с бухгалтерией', 'Образ системы'],
    7: ['ТЗ с деканатами', 'Прототип формы заявки', 'Роли и доступы', 'Уведомления на почту'],
    8: ['Обследование дверей', 'Подбор контроллеров'],
    9: ['Перенос ящиков', 'Настройка SPF/DKIM', 'Переключение MX'],
  };
  const projects = P.map(([name, status, ci, s, d, budget, members], i) => {
    const id = ins('projects', { name, status, client_id: clients[ci], owner_id: users[1], start_date: day(s), due_date: day(d), budget,
      description: `Проект «${name}». Цели, объём работ и контакты — в описании и задачах.` });
    for (const m of [0, ...members]) run('INSERT OR IGNORE INTO project_members VALUES (?,?)', id, users[m]);
    const list = TASKS[i] || [];
    list.forEach((title, j) => {
      const frac = status === 'done' ? 1 : status === 'planned' ? 0 : status === 'in_review' ? 0.8 : (j / list.length < 0.5 ? 1 : j === Math.floor(list.length / 2) ? 0.5 : 0);
      const st = frac === 1 ? 'done' : frac === 0.5 ? 'in_progress' : 'todo';
      const span = d - s;
      ins('tasks', { project_id: id, title, status: st, assignee_id: users[pickOne(members)], position: j,
        start_date: day(s + Math.floor((span * j) / list.length)), due_date: day(s + Math.floor((span * (j + 1)) / list.length)) });
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
        const pi = pickOne([0, 1, 2, 3, 7, 9]);
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
    inc.filter(([date]) => date <= today).forEach(([date, description, ci, category]) => ins('transactions', { type: 'income', amount: Math.round((250 + rnd() * 450) * 1000), category, date, description, client_id: clients[ci], project_id: projects[ci === 4 ? 3 : 0], created_by: users[0] }));
    [['Зарплата', 'ФОТ', 420000], ['Аренда офиса', 'Аренда', 85000], ['Закупка оборудования', 'Оборудование', 150000 + Math.round(rnd() * 200000)], ['Связь и хостинг', 'Связь', 12000]]
      .filter((_, j) => ds(3 + j * 6) <= today)
      .forEach(([description, category, amount], j) => ins('transactions', { type: 'expense', amount, category, date: ds(3 + j * 6), description, created_by: users[0] }));
  }

  const acts = [
    [1, 'project', projects[3], 'create', 'создал проект «Видеонаблюдение: 48 камер»'],
    [2, 'task', null, 'done', 'выполнила задачу «Схема L2/L3 корпуса №1»'],
    [4, 'ticket', tickets[0], 'create', `создала заявку #${tickets[0]} «Нет интернета в ауд. 305»`],
    [3, 'ticket', tickets[5], 'status', `изменил статус заявки #${tickets[5]} → resolved`],
    [1, 'deal', null, 'stage', 'перевёл сделку «Обслуживание по договору (год)» на этап won'],
  ];
  acts.forEach(([u, entity, entity_id, action, text], i) => ins('activity', { user_id: users[u], entity, entity_id, action, text,
    created_at: new Date(Date.now() - (acts.length - i) * 47 * 60e3).toISOString().replace('T', ' ').slice(0, 19) }));
});

console.log('Демо-данные загружены. Вход: admin@demo.ru / demo12345');
