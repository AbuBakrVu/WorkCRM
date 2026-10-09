import test from 'node:test';
import assert from 'node:assert/strict';
import { amountWords, numberWords, money, plural } from '../src/docgen.js';

test('число прописью', () => {
  assert.equal(numberWords(0), 'ноль');
  assert.equal(numberWords(21), 'двадцать один');
  assert.equal(numberWords(1000), 'одна тысяча');
  assert.equal(numberWords(2000), 'две тысячи');
  assert.equal(numberWords(11000), 'одиннадцать тысяч');
  assert.equal(numberWords(1234567), 'один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь');
});
test('сумма прописью с копейками', () => {
  assert.equal(amountWords(12345.6), 'Двенадцать тысяч триста сорок пять рублей 60 копеек');
  assert.equal(amountWords(1), 'Один рубль 00 копеек');
  assert.equal(amountWords(22.02), 'Двадцать два рубля 02 копейки');
  assert.equal(amountWords(0.01), 'Ноль рублей 01 копейка');
  assert.equal(amountWords(111), 'Сто одиннадцать рублей 00 копеек');
});
test('формат денег', () => {
  assert.equal(money(1234567.5), '1 234 567,50');
  assert.equal(money(0), '0,00');
});
test('склонение', () => {
  assert.equal(plural(1, 'день', 'дня', 'дней'), 'день');
  assert.equal(plural(3, 'день', 'дня', 'дней'), 'дня');
  assert.equal(plural(12, 'день', 'дня', 'дней'), 'дней');
  assert.equal(plural(21, 'день', 'дня', 'дней'), 'день');
});
