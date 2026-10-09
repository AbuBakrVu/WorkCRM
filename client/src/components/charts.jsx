// Общие элементы графиков (recharts): цвета серий, подсказка, легенда
import { fmtMoney } from '../lib/format';

export const C_INCOME = '#1e6a45';
export const C_EXPENSE = '#9fd2b1';

export function ChartTip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-panel border border-line rounded-xl shadow-lg px-3 py-2 text-[12px]">
      <div className="font-medium text-ink mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="text-ink tabular">{money ? fmtMoney(p.value) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }) {
  return <div className="flex items-center gap-4 text-[12px] text-ink-2">{items.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}</div>;
}
