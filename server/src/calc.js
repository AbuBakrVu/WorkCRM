// Расчёт сумм по позициям документа: НДС сверху или включён в цену
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcItems(items, mode = 'above') {
  let net = 0, vat = 0, total = 0;
  const rows = items.map((it) => {
    const rate = it.vat_rate && it.vat_rate !== 'none' ? Number(it.vat_rate) : 0;
    const base = r2(it.qty * it.price);
    let lineVat, lineTotal, lineNet;
    if (mode === 'included') { lineTotal = base; lineVat = r2((base * rate) / (100 + rate)); lineNet = r2(base - lineVat); }
    else { lineNet = base; lineVat = r2((base * rate) / 100); lineTotal = r2(base + lineVat); }
    net += lineNet; vat += lineVat; total += lineTotal;
    return { ...it, net: lineNet, vat: lineVat, total: lineTotal };
  });
  return { rows, net: r2(net), vat: r2(vat), total: r2(total) };
}
