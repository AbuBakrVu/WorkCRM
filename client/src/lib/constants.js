export const PROJECT_STATUS = {
  planned: { label: 'Запланирован', color: 'var(--color-st-planned)' },
  in_progress: { label: 'В работе', color: 'var(--color-st-progress)' },
  in_review: { label: 'На проверке', color: 'var(--color-st-review)' },
  stuck: { label: 'Застрял', color: 'var(--color-st-stuck)' },
  done: { label: 'Готово', color: 'var(--color-st-done)' },
};

export const TASK_STATUS = {
  todo: { label: 'К выполнению', color: 'var(--color-st-planned)' },
  in_progress: { label: 'В работе', color: 'var(--color-st-progress)' },
  done: { label: 'Готово', color: 'var(--color-st-done)' },
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
  lead: { label: 'Лид', color: '#c7cbd4' },
  qualified: { label: 'Квалификация', color: '#9cc6f5' },
  proposal: { label: 'КП отправлено', color: '#b9a8f7' },
  negotiation: { label: 'Переговоры', color: 'var(--color-st-progress)' },
  won: { label: 'Выиграна', color: 'var(--color-st-done)' },
  lost: { label: 'Проиграна', color: 'var(--color-st-stuck)' },
};

export const CLIENT_TYPE = { company: 'Организация', person: 'Частное лицо', internal: 'Внутренний' };

export const ROLES = { admin: 'Администратор', manager: 'Менеджер', member: 'Сотрудник' };

export const INCOME_CATEGORIES = ['Проекты', 'Обслуживание', 'Поставка оборудования', 'Консалтинг', 'Прочее'];
export const EXPENSE_CATEGORIES = ['ФОТ', 'Аренда', 'Оборудование', 'Связь', 'Транспорт', 'Налоги', 'Подрядчики', 'Прочее'];

export const USER_COLORS = ['#4f46e5', '#0ea5e9', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];
