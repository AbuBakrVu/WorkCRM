import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { Plus, TrendingUp, TrendingDown, Wallet, Trash2, Download, Receipt } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from '../lib/constants';
import { fmtMoney, fmtMoneyShort, fmtDate, MONTHS, toDateStr } from '../lib/format';
import { Button, Card, Modal, Field, Select, Stat, PageHeader, Empty, Spinner, cx, nameOptions } from '../components/ui';
import { ChartTip, Legend, C_INCOME, C_EXPENSE } from './Dashboard';

const PERIODS = { month: 'Этот месяц', prev: 'Прошлый месяц', quarter: '3 месяца', year: '12 месяцев' };
function periodRange(p) {
  const n = new Date();
  const s = (y, m) => toDateStr(new Date(y, m, 1));
  if (p === 'month') return [s(n.getFullYear(), n.getMonth()), null];
  if (p === 'prev') return [s(n.getFullYear(), n.getMonth() - 1), toDateStr(new Date(n.getFullYear(), n.getMonth(), 0))];
  if (p === 'quarter') return [s(n.getFullYear(), n.getMonth() - 2), null];
  return [s(n.getFullYear(), n.getMonth() - 11), null];
}

export default function Finance() {
  const [period, setPeriod] = useState('month');
  const [from, to] = periodRange(period);
  const { data } = useLoad(`/transactions?from=${from}${to ? `&to=${to}` : ''}`);
  const { data: sum } = useLoad('/transactions/summary');
  const { toast, bump } = useApp();
  const [form, setForm] = useState(null);
  const [type, setType] = useState('all');

  const list = useMemo(() => (data || []).filter((x) => type === 'all' || x.type === type), [data, type]);
  const income = (data || []).filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0);
  const expense = (data || []).filter((x) => x.type === 'expense').reduce((a, x) => a + x.amount, 0);
  const cats = useMemo(() => {
    const m = {};
    (data || []).filter((x) => x.type === 'expense').forEach((x) => { const k = x.category || 'Без категории'; m[k] = (m[k] || 0) + x.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data]);
  const chart = (sum?.months || []).map((m) => ({ ...m, label: `${MONTHS[+m.month.slice(5) - 1].slice(0, 3)} ${m.month.slice(2, 4)}` }));

  const del = async (id) => { try { await api.del(`/transactions/${id}`); bump(); toast('Удалено'); } catch (e) { toast(e.message, 'error'); } };
  const exportCsv = () => {
    const rows = [['Дата', 'Тип', 'Категория', 'Описание', 'Клиент', 'Проект', 'Сумма']];
    list.forEach((x) => rows.push([x.date, x.type === 'income' ? 'Доход' : 'Расход', x.category || '', x.description || '', x.client_name || '', x.project_name || '', String(x.type === 'income' ? x.amount : -x.amount).replace('.', ',')]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `finance-${from}.csv`; a.click();
  };

  return (
    <div>
      <PageHeader title="Финансы" subtitle="Доходы и расходы компании с привязкой к клиентам и проектам"
        actions={<>
          <Button icon={Download} onClick={exportCsv}>CSV</Button>
          <Button icon={TrendingDown} onClick={() => setForm({ type: 'expense' })}>Расход</Button>
          <Button variant="primary" icon={TrendingUp} onClick={() => setForm({ type: 'income' })}>Доход</Button>
        </>} />

      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(PERIODS).map(([k, l]) => <button key={k} className={cx('chip', period === k && 'chip-active')} onClick={() => setPeriod(k)}>{l}</button>)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Доходы" value={fmtMoneyShort(income)} icon={TrendingUp} tone="green" sub={fmtMoney(income)} />
        <Stat label="Расходы" value={fmtMoneyShort(expense)} icon={TrendingDown} tone="violet" sub={fmtMoney(expense)} />
        <Stat label="Прибыль" value={fmtMoneyShort(income - expense)} icon={Wallet} tone={income - expense >= 0 ? 'green' : 'red'}
          sub={income ? `Рентабельность ${Math.round(((income - expense) / income) * 100)}%` : '—'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mt-3">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold">По месяцам</h2>
            <Legend items={[[C_INCOME, 'Доход'], [C_EXPENSE, 'Расход']]} />
          </div>
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: 'var(--color-ink-3)' }} />
                <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11.5, fill: 'var(--color-ink-3)' }} tickFormatter={(v) => fmtMoneyShort(v).replace(' ₽', '')} />
                <Tooltip cursor={{ fill: 'var(--color-canvas)' }} content={<ChartTip money />} />
                <Bar dataKey="income" name="Доход" fill={C_INCOME} radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="expense" name="Расход" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold mb-3">Расходы по категориям</h2>
          <div className="space-y-3">
            {cats.length === 0 && <div className="text-[13px] text-ink-3">Нет расходов за период</div>}
            {cats.map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-[12.5px]"><span className="text-ink-2">{k}</span><span className="tabular">{fmtMoneyShort(v)} <span className="text-ink-3">· {Math.round((v / expense) * 100)}%</span></span></div>
                <div className="h-1.5 bg-line rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(v / cats[0][1]) * 100}%`, background: C_EXPENSE }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between mt-6 mb-2.5">
        <h2 className="text-[15px] font-semibold">Операции</h2>
        <div className="flex items-center gap-1 p-0.5 rounded-full border border-line bg-panel">
          {[['all', 'Все'], ['income', 'Доходы'], ['expense', 'Расходы']].map(([v, l]) => (
            <button key={v} onClick={() => setType(v)} className={cx('px-3 h-7 rounded-full text-[12px] font-medium', type === v ? 'bg-ink text-white' : 'text-ink-2')}>{l}</button>
          ))}
        </div>
      </div>
      {!data ? <Spinner /> : list.length === 0 ? <Card><Empty icon={Receipt} title="Операций нет" text="Добавьте доход или расход" /></Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-line bg-canvas/60">
              <th className="th">Дата</th><th className="th min-w-[220px]">Описание</th><th className="th">Категория</th><th className="th">Клиент / проект</th><th className="th text-right">Сумма</th><th className="th w-10" />
            </tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="group border-b border-line last:border-0 hover:bg-canvas/50 cursor-pointer" onClick={() => setForm(x)}>
                  <td className="td text-ink-3">{fmtDate(x.date)}</td>
                  <td className="td text-ink">{x.description || '—'}</td>
                  <td className="td">{x.category || '—'}</td>
                  <td className="td max-w-[240px] truncate">{[x.client_name, x.project_name].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={cx('td text-right tabular font-medium', x.type === 'income' ? 'text-emerald-700' : 'text-ink')}>{x.type === 'income' ? '+' : '−'}{fmtMoney(x.amount)}</td>
                  <td className="td"><button onClick={(e) => { e.stopPropagation(); del(x.id); }} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-ink-3 hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <TxModal tx={form} onClose={() => setForm(null)} />
    </div>
  );
}

function TxModal({ tx, onClose }) {
  const { clients, projects, toast, bump } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (tx) setF({ date: toDateStr(new Date()), ...tx }); }, [tx]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const cats = f.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const submit = async (e) => {
    e?.preventDefault();
    if (!(+f.amount > 0)) return toast('Укажите сумму', 'error');
    const body = { type: f.type, amount: +f.amount, category: f.category, date: f.date, description: f.description, client_id: f.client_id ? +f.client_id : null, project_id: f.project_id ? +f.project_id : null };
    try { f.id ? await api.put(`/transactions/${f.id}`, body) : await api.post('/transactions', body); toast('Сохранено'); bump(); onClose(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Modal open={!!tx} onClose={onClose} title={f.id ? 'Операция' : f.type === 'income' ? 'Новый доход' : 'Новый расход'} width={520}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Тип"><Select value={f.type} onChange={set('type')} options={[{ value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }]} /></Field>
        <Field label="Сумма, ₽"><input type="number" min="0" step="0.01" className="input" value={f.amount || ''} onChange={set('amount')} autoFocus /></Field>
        <Field label="Дата"><input type="date" className="input" value={f.date || ''} onChange={set('date')} /></Field>
        <Field label="Категория"><Select value={f.category} onChange={set('category')} placeholder="—" options={cats.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="Проект"><Select value={f.project_id} onChange={set('project_id')} placeholder="—" search options={nameOptions(projects)} /></Field>
        <Field label="Описание" className="col-span-2"><input className="input" value={f.description || ''} onChange={set('description')} /></Field>
      </form>
    </Modal>
  );
}
