import test from 'node:test';
import assert from 'node:assert/strict';
import { calcItems } from '../src/calc.js';

test('НДС сверху: 20% начисляется на сумму', () => {
  const r = calcItems([{ name: 'Работа', qty: 2, price: 1000, vat_rate: '20' }], 'above');
  assert.equal(r.net, 2000); assert.equal(r.vat, 400); assert.equal(r.total, 2400);
});
test('НДС в том числе: выделяется из суммы', () => {
  const r = calcItems([{ qty: 1, price: 1200, vat_rate: '20' }], 'included');
  assert.equal(r.total, 1200); assert.equal(r.vat, 200); assert.equal(r.net, 1000);
});
test('без НДС: итог равен сумме', () => {
  for (const rate of ['none', null, undefined, '']) {
    const r = calcItems([{ qty: 3, price: 99.99, vat_rate: rate }]);
    assert.equal(r.vat, 0); assert.equal(r.total, 299.97);
  }
});
test('округление до копеек по каждой строке', () => {
  const r = calcItems([{ qty: 1, price: 0.1, vat_rate: '20' }, { qty: 1, price: 0.2, vat_rate: '20' }]);
  assert.equal(r.total, 0.36); // 0.12 + 0.24
});
test('смешанные ставки', () => {
  const r = calcItems([{ qty: 1, price: 100, vat_rate: '20' }, { qty: 1, price: 100, vat_rate: '10' }, { qty: 1, price: 100, vat_rate: 'none' }]);
  assert.equal(r.vat, 30); assert.equal(r.total, 330);
});
