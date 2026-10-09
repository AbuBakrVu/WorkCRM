import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDate, addDays } from '../src/recurrence.js';

test('ежедневно и каждые N дней', () => {
  assert.equal(nextDate({ freq: 'daily', every: 1 }, '2026-10-09'), '2026-10-10');
  assert.equal(nextDate({ freq: 'daily', every: 3 }, '2026-10-09'), '2026-10-12');
  assert.equal(nextDate({ freq: 'daily', every: 3 }, '2026-10-09', true), '2026-10-09');
});
test('еженедельно по дням недели (1 = пн)', () => {
  // 2026-10-09 — пятница
  assert.equal(nextDate({ freq: 'weekly', every: 1, weekdays: '1,3' }, '2026-10-09'), '2026-10-12');
  assert.equal(nextDate({ freq: 'weekly', every: 1, weekdays: '5' }, '2026-10-09', true), '2026-10-09');
  assert.equal(nextDate({ freq: 'weekly', every: 2, weekdays: '1' }, '2026-10-12', false, '2026-10-12'), '2026-10-26');
});
test('ежемесячно: 31-е число в коротком месяце', () => {
  assert.equal(nextDate({ freq: 'monthly', every: 1, monthday: 31 }, '2026-01-31'), '2026-02-28');
  assert.equal(nextDate({ freq: 'monthly', every: 1, monthday: 31 }, '2026-02-28'), '2026-03-31');
  assert.equal(nextDate({ freq: 'monthly', every: 1, monthday: 15 }, '2026-12-20'), '2027-01-15');
});
test('раз в квартал', () => {
  assert.equal(nextDate({ freq: 'monthly', every: 3, monthday: 1 }, '2026-01-01'), '2026-04-01');
});
test('ежегодно, 29 февраля', () => {
  assert.equal(nextDate({ freq: 'yearly', every: 1 }, '2024-02-29', false, '2024-02-29'), '2025-02-28');
  assert.equal(nextDate({ freq: 'yearly', every: 1 }, '2027-02-28', false, '2024-02-29'), '2028-02-29');
});
test('addDays переходит через границы месяца и года', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
