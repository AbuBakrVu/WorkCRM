// Повторяющиеся задачи: правило → дата следующего запуска
// freq: daily | weekly | monthly | yearly; every — каждые N; weekdays — '1,3,5' (1 = пн … 7 = вс); monthday — число месяца
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isoDow = (d) => ((d.getUTCDay() + 6) % 7) + 1;
const weekIndex = (d) => Math.floor((d.getTime() / 864e5 + 3) / 7); // недели с понедельника

// «Сегодня» по Москве — сервер живёт в UTC, а работа идёт по МСК
export function todayMsk() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}

// Первая подходящая дата >= from (если inclusive) или > from
export function nextDate(rule, from, inclusive = false, anchor = from) {
  const every = Math.max(1, Number(rule.every) || 1);
  if (rule.freq === 'daily') return inclusive ? from : addDays(from, every);
  if (rule.freq === 'weekly') {
    const days = String(rule.weekdays || '').split(',').map(Number).filter((x) => x >= 1 && x <= 7);
    const set = new Set(days.length ? days : [isoDow(parse(anchor))]);
    const aw = weekIndex(parse(anchor));
    for (let i = inclusive ? 0 : 1; i < 7 * every * 2 + 8; i++) {
      const d = parse(addDays(from, i));
      if (set.has(isoDow(d)) && (weekIndex(d) - aw) % every === 0) return ymd(d);
    }
    return addDays(from, 7);
  }
  if (rule.freq === 'monthly') {
    const f = parse(from);
    const want = Number(rule.monthday) || f.getUTCDate();
    for (let k = 0; k <= 24; k++) {
      const y = f.getUTCFullYear(), m = f.getUTCMonth() + k;
      const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
      const d = ymd(new Date(Date.UTC(yy, mm, Math.min(want, daysInMonth(yy, mm)))));
      const monthsFromAnchor = (yy - parse(anchor).getUTCFullYear()) * 12 + mm - parse(anchor).getUTCMonth();
      if ((inclusive ? d >= from : d > from) && monthsFromAnchor % every === 0) return d;
    }
    return addDays(from, 30);
  }
  if (rule.freq === 'yearly') {
    const a = parse(anchor);
    for (let k = 0; k <= every * 3 + 1; k++) {
      const y = parse(from).getUTCFullYear() + k;
      const d = ymd(new Date(Date.UTC(y, a.getUTCMonth(), Math.min(a.getUTCDate(), daysInMonth(y, a.getUTCMonth())))));
      if ((inclusive ? d >= from : d > from) && (y - a.getUTCFullYear()) % every === 0) return d;
    }
  }
  return addDays(from, 365);
}
export { addDays };
