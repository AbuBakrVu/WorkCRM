import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, runRecurrences, runInvoiceSchedules } from './routes.js';
import { trashAutoPurge } from './audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api', api);

// Статика собранного фронтенда
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(__dirname, '../public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '7d', setHeaders: (res, p) => {
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

app.listen(PORT, () => console.log(`CRM запущена на http://localhost:${PORT}`));

// Повторяющиеся задачи и счета: проверка при старте и каждые 10 минут
const tick = () => {
  try { runRecurrences(); } catch (e) { console.error(e); }
  try { runInvoiceSchedules(); } catch (e) { console.error(e); }
  try { trashAutoPurge(30); } catch (e) { console.error(e); }
};
tick();
setInterval(tick, 10 * 60 * 1000);
