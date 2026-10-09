import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { buildUpd } from '../src/docgen.js';
import { calcItems } from '../src/calc.js';

const co = { name: 'ООО «Ромашка»', full_name: 'Общество с ограниченной ответственностью «Ромашка»', inn: '7701234567', kpp: '770101001', director_name: 'Иванов Иван Петрович', edo_id: '2BE1' };
const cl = { name: 'ИП Сидоров', inn: '770123456789', director_name: 'Сидоров Сидор Сидорович', address: 'Москва' };
const mk = (vat) => {
  const t = calcItems([{ name: 'Обслуживание', unit: 'мес', qty: 2, price: 5000, vat_rate: vat }]);
  return { company: co, client: cl, doc: { number: 'УПД-1', date: '2026-10-09', contract_no: '5' }, items: t.rows, totals: t };
};
const xml = (r) => iconv.decode(r.buffer, 'win1251');

test('УПД с НДС: функция СЧФДОП, суммы и налог', () => {
  const x = xml(buildUpd(mk('20')));
  assert.match(x, /Функция="СЧФДОП"/);
  assert.match(x, /ВерсФорм="5.03"/);
  assert.match(x, /СтТовБезНДС="10000.00"/);
  assert.match(x, /СтТовУчНал="12000.00"/);
  assert.match(x, /<СумНал>2000.00<\/СумНал>/);
});
test('УПД без НДС: функция ДОП', () => {
  const x = xml(buildUpd(mk('none')));
  assert.match(x, /Функция="ДОП"/);
  assert.match(x, /без НДС/);
});
test('кодировка windows-1251, ИП определяется по длине ИНН', () => {
  const r = buildUpd(mk('20'));
  assert.match(r.buffer.subarray(0, 60).toString('latin1'), /windows-1251/);
  const x = xml(r);
  assert.match(x, /<СвИП ИННФЛ="770123456789"/);
  assert.match(x, /<СвЮЛУч /);
  assert.match(r.name, /^ON_NSCHFDOPPR_/);
});
test('спецсимволы в названии экранируются', () => {
  const m = mk('20'); m.items[0].name = 'Кабель <Cat6> & "розетка"';
  const x = xml(buildUpd(m));
  assert.match(x, /Кабель &lt;Cat6&gt; &amp; &quot;розетка&quot;/);
});
