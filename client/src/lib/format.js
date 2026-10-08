// Даты из SQLite приходят как 'YYYY-MM-DD HH:MM:SS' (UTC) или ISO — приводим к Date
export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  if (s.includes('T')) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN_SHORT = MONTHS_SHORT;

export function fmtDate(v, withYear = false) {
  const d = parseDate(v);
  if (!d || isNaN(d)) return '—';
  const s = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return withYear || d.getFullYear() !== new Date().getFullYear() ? `${s} ${d.getFullYear()}` : s;
}
export function fmtDateTime(v) {
  const d = parseDate(v);
  if (!d || isNaN(d)) return '—';
  return `${fmtDate(d)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtTime(v) {
  const d = parseDate(v);
  return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
}
export function timeAgo(v) {
  const d = parseDate(v);
  if (!d) return '';
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} дн назад`;
  return fmtDate(d);
}

// Длительность: 01:34 ч (как на макете) или «5 ч 20 мин»
export function fmtHM(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function fmtHMS(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function fmtHours(sec) {
  const h = (sec || 0) / 3600;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} ч`;
}

const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const fmtMoney = (n) => `${rub.format(Math.round(n || 0))} ₽`;
export function fmtMoneyShort(n) {
  n = Number(n || 0);
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} млн ₽`;
  if (a >= 1e3) return `${Math.round(n / 1e3)} тыс ₽`;
  return `${Math.round(n)} ₽`;
}

export const todayStr = () => toDateStr(new Date());
export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initials(name = '') {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Деньги с копейками: 12 345,60 ₽
const rub2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRub = (n) => `${rub2.format(n || 0)} ₽`;
