export const PROJECT_STATUS = {
  planned: { label: 'Запланирован', color: 'var(--color-st-planned)' },
  in_progress: { label: 'В работе', color: 'var(--color-st-progress)' },
  in_review: { label: 'На проверке', color: 'var(--color-st-review)' },
  stuck: { label: 'Застрял', color: 'var(--color-st-stuck)' },
  done: { label: 'Готово', color: 'var(--color-st-done)' },
};

export const TASK_STATUS = {
  todo: { label: 'Открыта', color: '#a5b4fc' },
  in_progress: { label: 'В работе', color: 'var(--color-st-progress)' },
  done: { label: 'Закрыта', color: 'var(--color-st-done)' },
};

// Фильтр задач на странице проектов
export const TASK_FILTERS = {
  open: { label: 'Открытые', test: (t) => t.status !== 'done' },
  in_progress: { label: 'В работе', test: (t) => t.status === 'in_progress' },
  overdue: { label: 'Просроченные', test: (t, today) => t.status !== 'done' && t.due_date && t.due_date < today },
  done: { label: 'Закрытые', test: (t) => t.status === 'done' },
  all: { label: 'Все', test: () => true },
};

export const TICKET_STATUS = {
  new: { label: 'Новая', color: '#a5b4fc' },
  in_progress: { label: 'В работе', color: 'var(--color-st-progress)' },
  waiting: { label: 'Ожидание', color: 'var(--color-st-review)' },
  resolved: { label: 'Решена', color: 'var(--color-st-done)' },
  closed: { label: 'Закрыта', color: 'var(--color-st-planned)' },
};

export const TICKET_PRIORITY = {
  critical: { label: 'Критичный', color: '#dc2626', bg: '#fee2e2', sla: 4 },
  high: { label: 'Высокий', color: '#c2410c', bg: '#ffedd5', sla: 8 },
  normal: { label: 'Обычный', color: '#4b5262', bg: '#eef0f3', sla: 24 },
  low: { label: 'Низкий', color: '#6b7280', bg: '#f4f5f7', sla: 72 },
};

export const TICKET_CATEGORY = {
  network: 'Сеть',
  hardware: 'Оборудование',
  software: 'ПО',
  access: 'Доступы и учётки',
  printer: 'Печать',
  other: 'Другое',
};

export const DEAL_STAGE = {
  lead: { label: 'Лид', color: '#c7cbd4', prob: 10 },
  qualified: { label: 'Квалификация', color: '#9cc6f5', prob: 25 },
  proposal: { label: 'КП отправлено', color: '#b9a8f7', prob: 50 },
  negotiation: { label: 'Переговоры', color: 'var(--color-st-progress)', prob: 75 },
  won: { label: 'Выиграна', color: 'var(--color-st-done)', prob: 100 },
  lost: { label: 'Проиграна', color: 'var(--color-st-stuck)', prob: 0 },
};
// Вероятность сделки: указанная вручную или по этапу
export const dealProb = (d) => (d.probability ?? DEAL_STAGE[d.stage]?.prob ?? 0);
export const LOST_REASONS = ['Дорого', 'Выбрали конкурента', 'Нет бюджета', 'Не вышли на связь', 'Проект отменён / отложен', 'Не подошли условия или сроки', 'Другое'];

export const CLIENT_TYPE = { company: 'Организация', person: 'Частное лицо', internal: 'Внутренний' };

export const ROLES = { admin: 'Администратор', manager: 'Менеджер', member: 'Сотрудник' };

export const INCOME_CATEGORIES = ['Проекты', 'Обслуживание', 'Поставка оборудования', 'Консалтинг', 'Прочее'];
export const EXPENSE_CATEGORIES = ['ФОТ', 'Аренда', 'Оборудование', 'Связь', 'Транспорт', 'Налоги', 'Подрядчики', 'Прочее'];

export const USER_COLORS = ['#4f46e5', '#0ea5e9', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

// НДС: ставка на позицию сделки и режим расчёта
export const VAT_RATES = [
  { value: 'none', label: 'Без НДС' }, { value: '0', label: '0%' }, { value: '5', label: '5%' }, { value: '7', label: '7%' },
  { value: '10', label: '10%' }, { value: '20', label: '20%' }, { value: '22', label: '22%' },
];
export const VAT_MODE = { above: 'НДС сверху', included: 'В т.ч. НДС' };
export const UNITS = ['шт', 'усл', 'ч', 'мес', 'компл', 'м', 'упак', 'лиц'];

export const INVOICE_STATUS = {
  issued: { label: 'Ждёт оплаты', color: 'var(--color-st-review)' },
  partial: { label: 'Оплачен частично', color: 'var(--color-st-progress)' },
  overdue: { label: 'Просрочен', color: 'var(--color-st-stuck)' },
  paid: { label: 'Оплачен', color: 'var(--color-st-done)' },
  cancelled: { label: 'Отменён', color: 'var(--color-st-planned)' },
};
