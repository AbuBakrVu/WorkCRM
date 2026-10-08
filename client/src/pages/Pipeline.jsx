import { useMemo, useState } from 'react';
import { Plus, Calendar, Handshake, TrendingUp, Trophy, Target, XCircle, BarChart3, Columns3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { useApp, useLoad, useStored } from '../lib/store';
import { api } from '../lib/api';
import { DEAL_STAGE, LOST_REASONS, dealProb } from '../lib/constants';
import { fmtMoney, fmtMoneyShort, fmtDate, parseDate, plural } from '../lib/format';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
import { Button, Avatar, PageHeader, Stat, Spinner, Card, Modal, Field, Tabs, cx } from '../components/ui';
import { DealModal } from '../components/DealModal';
import { ChartTip, C_INCOME, C_EXPENSE } from './Dashboard';

export default function Pipeline() {
  const { data, setData } = useLoad('/deals');
  const { toast, bump } = useApp();
  const [view, setView] = useStored('crm.pipeline.view', 'board');
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [form, setForm] = useState(null);
  const [losing, setLosing] = useState(null); // сделка, для которой спрашиваем причину проигрыша

  if (!data) return <Spinner />;
  const move = async (id, stage, extra = {}) => {
    const d = data.find((x) => x.id === id);
    if (!d || d.stage === stage) return;
    if (stage === 'lost' && !extra.lost_reason) { setLosing(d); return; }
    setData((list) => list.map((x) => (x.id === id ? { ...x, stage, ...extra } : x)));
    try { await api.put(`/deals/${id}`, { stage, ...extra }); bump(); } catch (e) { toast(e.message, 'error'); bump(); }
  };
  const open = data.filter((d) => !['won', 'lost'].includes(d.stage));
  const won = data.filter((d) => d.stage === 'won');
  const lost = data.filter((d) => d.stage === 'lost');
  const conv = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const forecast = open.reduce((a, d) => a + (d.amount * dealProb(d)) / 100, 0);

  return (
    <div>
      <PageHeader title="Воронка сделок" subtitle="Перетаскивайте карточки между этапами"
        actions={<Button variant="primary" icon={Plus} onClick={() => setForm({})}>Новая сделка</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="В работе" value={fmtMoneyShort(open.reduce((a, d) => a + d.amount, 0))} sub={`${open.length} ${plural(open.length, 'сделка', 'сделки', 'сделок')}`} icon={Handshake} featured />
        <Stat label="Прогноз" value={fmtMoneyShort(forecast)} sub="с учётом вероятности по этапам" icon={Target} />
        <Stat label="Выиграно" value={fmtMoneyShort(won.reduce((a, d) => a + d.amount, 0))} sub={`${won.length} ${plural(won.length, 'сделка', 'сделки', 'сделок')}`} icon={Trophy} />
        <Stat label="Конверсия" value={`${conv}%`} sub="выигранные из закрытых" icon={TrendingUp} />
      </div>
      <div className="mb-4"><Tabs value={view} onChange={setView} tabs={[{ value: 'board', label: 'Воронка', icon: Columns3 }, { value: 'stats', label: 'Аналитика', icon: BarChart3 }]} /></div>
      {view === 'stats' ? <PipelineStats deals={data} /> : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {Object.entries(DEAL_STAGE).map(([stage, s]) => {
            const items = data.filter((d) => d.stage === stage);
            return (
              <div key={stage} onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver(null)}
                onDrop={() => { if (dragId) move(dragId, stage); setDragId(null); setOver(null); }}
                className={cx('w-[270px] shrink-0 rounded-2xl border p-2.5 transition-colors', over === stage ? 'bg-violet/5 border-violet/30' : 'bg-canvas/70 border-line')}>
                <div className="px-1.5 pb-2.5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium"><span className="size-3.5 rounded" style={{ background: s.color }} />{s.label}</span>
                    <span className="text-[12px] text-ink-3">{items.length}</span>
                  </div>
                  <div className="text-[12px] text-ink-3 mt-0.5 tabular">{fmtMoney(items.reduce((a, d) => a + d.amount, 0))}{!['won', 'lost'].includes(stage) && <span className="opacity-70"> · {s.prob}%</span>}</div>
                </div>
                <div className="space-y-2 min-h-16">
                  {items.map((d) => {
                    const late = d.expected_close && !['won', 'lost'].includes(d.stage) && parseDate(d.expected_close) < new Date(new Date().toDateString());
                    return (
                      <div key={d.id} draggable onDragStart={() => setDragId(d.id)} onClick={() => setForm(d)}
                        className={cx('bg-panel rounded-xl border border-line p-3 cursor-pointer hover:shadow-md transition-shadow', dragId === d.id && 'opacity-50')}>
                        <div className="text-[13.5px] font-medium leading-snug">{d.title}</div>
                        <div className="text-[12px] text-ink-3 truncate mt-0.5">{d.client_name || 'Без клиента'}</div>
                        {d.items_count > 0 && <div className="text-[11.5px] text-ink-3 mt-1">{d.items_count} {plural(d.items_count, 'позиция', 'позиции', 'позиций')}{d.company_name ? ` · ${d.company_name}` : ''}</div>}
                        {d.stage === 'lost' && d.lost_reason && <div className="text-[11.5px] text-red-600 mt-1 inline-flex items-center gap-1"><XCircle size={11} />{d.lost_reason}</div>}
                        <div className="flex items-center justify-between mt-2.5">
                          <span className="text-[13.5px] font-semibold tabular">{fmtMoney(d.amount)}</span>
                          <div className="flex items-center gap-2">
                            {d.expected_close && <span className={cx('inline-flex items-center gap-1 text-[11.5px]', late ? 'text-red-600' : 'text-ink-3')}><Calendar size={11} />{fmtDate(d.expected_close)}</span>}
                            <Avatar user={d.owner_name ? { name: d.owner_name, color: d.owner_color } : null} size={20} ring={false} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {form && <DealModal deal={form} onClose={() => setForm(null)} />}
      {losing && <LostModal deal={losing} onClose={() => setLosing(null)} onConfirm={(r) => { move(losing.id, 'lost', r); setLosing(null); }} />}
    </div>
  );
}

// Причина проигрыша — обязательна при переводе в «Проиграна»
export function LostModal({ deal, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  return (
    <Modal open onClose={onClose} title="Почему сделка проиграна?" width={480}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="danger" disabled={!reason} onClick={() => onConfirm({ lost_reason: reason, lost_comment: comment || null })}>Сделка проиграна</Button></>}>
      <div className="text-[13px] text-ink-2 mb-3">«{deal.title}»{deal.client_name ? ` — ${deal.client_name}` : ''}</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {LOST_REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className={cx('h-8 px-3 rounded-full border text-[12.5px] transition-colors', reason === r ? 'bg-red-50 border-red-300 text-red-700 font-medium' : 'border-line text-ink-2 hover:bg-canvas')}>{r}</button>
        ))}
      </div>
      <Field label="Комментарий"><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что можно было сделать иначе" /></Field>
    </Modal>
  );
}

/* ---------- Аналитика продаж ---------- */
function PipelineStats({ deals }) {
  const open = deals.filter((d) => !['won', 'lost'].includes(d.stage));
  // Прогноз по месяцам ожидаемого закрытия: 6 месяцев вперёд + просроченные и без даты
  const months = useMemo(() => {
    const now = new Date(); const out = [];
    for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, total: 0, weighted: 0 }); }
    const firstKey = out[0].key;
    const late = { key: 'late', label: 'Просрочено', total: 0, weighted: 0 };
    const none = { key: 'none', label: 'Без даты', total: 0, weighted: 0 };
    for (const d of open) {
      const k = d.expected_close?.slice(0, 7);
      const b = !k ? none : k < firstKey ? late : out.find((m) => m.key === k);
      if (!b) continue;
      b.total += d.amount; b.weighted += Math.round((d.amount * dealProb(d)) / 100);
    }
    return [...(late.total ? [late] : []), ...out, ...(none.total ? [none] : [])];
  }, [open]);
  const lostBy = useMemo(() => {
    const m = {};
    for (const d of deals.filter((x) => x.stage === 'lost')) { const r = d.lost_reason || 'Не указана'; (m[r] ??= { reason: r, n: 0, sum: 0 }); m[r].n++; m[r].sum += d.amount; }
    return Object.values(m).sort((a, b) => b.n - a.n);
  }, [deals]);
  const won = deals.filter((d) => d.stage === 'won');
  const cycle = won.filter((d) => d.closed_at).map((d) => (parseDate(d.closed_at) - parseDate(d.created_at)) / 864e5);
  const avgCycle = cycle.length ? Math.round(cycle.reduce((a, x) => a + x, 0) / cycle.length) : null;
  const avgWon = won.length ? won.reduce((a, d) => a + d.amount, 0) / won.length : 0;
  const maxLost = Math.max(1, ...lostBy.map((x) => x.n));
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card className="p-5 lg:col-span-2">
        <h2 className="text-[15px] font-semibold">Прогноз по месяцам</h2>
        <p className="text-[12.5px] text-ink-3 mb-3">По ожидаемой дате закрытия: сумма открытых сделок и взвешенный прогноз (сумма × вероятность этапа)</p>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <BarChart data={months} barGap={3} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-ink-3)' }} />
              <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: 'var(--color-ink-3)' }} tickFormatter={(v) => fmtMoneyShort(v).replace(' ₽', '')} />
              <Tooltip cursor={{ fill: 'var(--color-canvas)' }} content={<ChartTip money />} />
              <Bar dataKey="total" name="Сумма сделок" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="weighted" name="Прогноз" fill={C_INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold mb-3">Показатели</h2>
        <div className="space-y-3 text-[13px]">
          {[['Средняя выигранная сделка', won.length ? fmtMoney(avgWon) : '—'], ['Средний цикл сделки', avgCycle != null ? `${avgCycle} ${plural(avgCycle, 'день', 'дня', 'дней')}` : '—'],
            ['Открыто сделок', open.length], ['Выиграно / проиграно', `${won.length} / ${deals.filter((d) => d.stage === 'lost').length}`]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><span className="text-ink-3">{k}</span><span className="font-semibold tabular">{v}</span></div>
          ))}
        </div>
        <h3 className="text-[13px] font-semibold mt-5 mb-2">По этапам</h3>
        <div className="space-y-1.5">
          {Object.entries(DEAL_STAGE).filter(([k]) => !['won', 'lost'].includes(k)).map(([k, s]) => {
            const list = open.filter((d) => d.stage === k);
            return <div key={k} className="flex items-center gap-2 text-[12.5px]"><span className="size-2.5 rounded" style={{ background: s.color }} /><span className="flex-1">{s.label}</span><span className="text-ink-3 tabular">{list.length} · {fmtMoneyShort(list.reduce((a, d) => a + d.amount, 0))}</span></div>;
          })}
        </div>
      </Card>
      <Card className="p-5 lg:col-span-3">
        <h2 className="text-[15px] font-semibold mb-3">Причины проигрыша</h2>
        {!lostBy.length ? <div className="text-[13px] text-ink-3">Проигранных сделок нет</div> : (
          <div className="space-y-2.5">
            {lostBy.map((r) => (
              <div key={r.reason} className="grid grid-cols-[220px_1fr_auto] items-center gap-3 text-[13px]">
                <span className="truncate">{r.reason}</span>
                <div className="h-2 rounded-full bg-line overflow-hidden"><div className="h-full rounded-full bg-st-stuck" style={{ width: `${(r.n / maxLost) * 100}%` }} /></div>
                <span className="tabular text-ink-2 w-40 text-right">{r.n} {plural(r.n, 'сделка', 'сделки', 'сделок')} · {fmtMoneyShort(r.sum)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
