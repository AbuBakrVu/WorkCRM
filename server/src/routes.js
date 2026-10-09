import { api } from './routes/shared.js';
import './routes/auth.js';
import './routes/clients.js';
import './routes/tasks.js';
import './routes/tickets.js';
import './routes/companies.js';
import './routes/deals.js';
import './routes/invoices.js';
import './routes/admin.js';
import './routes/documents.js';
import './routes/infra.js';
import './routes/portal.js';
import './routes/import.js';
import './routes/reports.js';
import './routes/time.js';
import './routes/dashboard.js';
export { api };
import { HttpError } from './routes/shared.js';
export { getSetting } from './routes/companies.js';
export { nextDocNumber, runInvoiceSchedules } from './routes/invoices.js';
export { mentionedUsers, purgeNotifications, runRecurrences } from './routes/tasks.js';
export { calcItems } from './routes/deals.js';

/* ---------- errors ---------- */
api.use((req, res) => res.status(404).json({ error: 'Маршрут не найден' }));
api.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Файл слишком большой (максимум 25 МБ)' });
  const msg = String(err?.message || err);
  if (msg.includes('CHECK constraint')) return res.status(400).json({ error: 'Недопустимое значение поля' });
  if (msg.includes('FOREIGN KEY')) return res.status(400).json({ error: 'Связанная запись не найдена' });
  if (msg.includes('UNIQUE')) return res.status(400).json({ error: 'Такая запись уже существует' });
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

