import { useMemo, useState } from 'react';
import { Users, PiggyBank, FileText, Printer, AlertTriangle, ArrowUpDown } from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { fmtMoney, todayStr, toDateStr, plural } from '../lib/format';
import { PageHeader, Tabs, Card, Spinner, Empty, Button, Field, Select, Avatar, Segmented, cx, nameOptions } from '../components/ui';

// Пресеты периода
function presetRange(p) {
  const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
  if (p === 'month') return [toDateStr(new Date(y, m, 1)), todayStr()];
  if (p === 'prev') return [toDateStr(new Date(y, m - 1, 1)), toDateStr(new Date(y, m, 0))];
  if (p === 'quarter') { const q = Math.floor(m / 3) * 3; return [toDateStr(new Date(y, q, 1)), todayStr()]; }
  if (p === 'year') return [toDateStr(new Date(y, 0, 1)), todayStr()];
  return null;
}
export function PeriodPicker({ value, onChange }) {
  const [preset, setPreset] = useState('month');
  const pick = (p) => { setPreset(p); const r = presetRange(p); if (r) onChange({ from: r[0], to: r[1] }); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={preset} onChange={pick} items={[{ value: 'month', label: 'Этот месяц' }, { value: 'prev', label: 'Прошлый' }, { value: 'quarter', label: 'Квартал' }, { value: 'year', label: 'Год' }, { value: 'custom', label: 'Период' }]} />
      {preset === 'custom' && (<>
        <input type="date" className="input !w-auto" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <span className="text-ink-3">—</span>
        <input type="date" className="input !w-auto" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </>)}
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useStored('crm.reports.tab', 'team');
  const [range, setRange] = useState(() => { const r = presetRange('month'); return { from: r[0], to: r[1] }; });
  return (
    <div>
      <PageHeader title="Отчёты" subtitle="Работа команды, рентабельность клиентов и отчёты для клиентов" />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'team', label: 'Сотрудники', icon: Users }, { value: 'profit', label: 'Рентабельность клиентов', icon: PiggyBank }, { value: 'client', label: 'Отчёт клиенту', icon: FileText }]} /></div>
      <div className="mb-4"><PeriodPicker value={range} onChange={setRange} /></div>
      {tab === 'team' ? <TeamReport range={range} /> : tab === 'profit' ? <ProfitReport range={range} /> : <ClientReportForm range={range} />}
    </div>
  );
}

function SortTh({ k, sort, setSort, children, right }) {
  return (
    <th className={cx('th cursor-pointer select-none hover:text-ink', right && 'text-right')} onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>
      <span className={cx('inline-flex items-center gap-1', right && 'flex-row-reverse')}>{children}<ArrowUpDown size={11} className={sort.k === k ? 'text-ink' : 'text-ink-3/50'} /></span>
    </th>
  );
}
const useSorted = (rows, sort) => useMemo(() => [...(rows || [])].sort((a, b) => ((a[sort.k] ?? -1) > (b[sort.k] ?? -1) ? 1 : -1) * sort.dir), [rows, sort]);

function TeamReport({ range }) {
  const { data } = useLoad(`/reports/team?from=${range.from}&to=${range.to}`, [range.from, range.to]);
  const [sort, setSort] = useState({ k: 'hours', dir: -1 });
  const rows = useSorted(data?.rows.filter((r) => r.active || r.hours), sort);
  if (!data) return <Spinner />;
  const p = { sort, setSort };
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-canvas/60 border-b border-line">
            <th className="th">Сотрудник</th><SortTh k="hours" right {...p}>Часы</SortTh><SortTh k="days" right {...p}>Рабочих дней</SortTh>
            <SortTh k="tasks_closed" right {...p}>Закрыто задач</SortTh><SortTh k="avg_close_days" right {...p}>Ср. срок, дн</SortTh>
            <SortTh k="tasks_open" right {...p}>В работе</SortTh><SortTh k="tasks_overdue" right {...p}>Просрочено</SortTh><SortTh k="tickets_resolved" right {...p}>Решено заявок</SortTh>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="td"><span className="flex items-center gap-2.5"><Avatar user={u} size={28} ring={false} /><span><span className="block text-ink font-medium">{u.name}</span><span className="block text-[11.5px] text-ink-3">{u.position || ''}</span></span></span></td>
                <td className="td text-right tabular font-semibold text-ink">{String(u.hours).replace('.', ',')}</td>
                <td className="td text-right tabular">{u.days}</td>
                <td className="td text-right tabular">{u.tasks_closed}{u.tasks_closed_late > 0 && <span className="text-[11.5px] text-amber-600"> · {u.tasks_closed_late} с опозд.</span>}</td>
                <td className="td text-right tabular">{u.avg_close_days ?? '—'}</td>
                <td className="td text-right tabular">{u.tasks_open}</td>
                <td className={cx('td text-right tabular', u.tasks_overdue > 0 && 'text-red-600 font-semibold')}>{u.tasks_overdue || '—'}</td>
                <td className="td text-right tabular">{u.tickets_resolved}{u.tickets_late > 0 && <span className="text-[11.5px] text-amber-600"> · {u.tickets_late} вне SLA</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line bg-canvas/40">
            <td className="td font-semibold">Команда</td>
            <td className="td text-right tabular font-semibold">{String(Math.round(rows.reduce((a, u) => a + u.hours, 0) * 100) / 100).replace('.', ',')}</td><td />
            <td className="td text-right tabular font-semibold">{rows.reduce((a, u) => a + u.tasks_closed, 0)}</td><td />
            <td className="td text-right tabular font-semibold">{rows.reduce((a, u) => a + u.tasks_open, 0)}</td>
            <td className="td text-right tabular font-semibold">{rows.reduce((a, u) => a + u.tasks_overdue, 0)}</td>
            <td className="td text-right tabular font-semibold">{rows.reduce((a, u) => a + u.tickets_resolved, 0)}</td>
          </tr></tfoot>
        </table>
      </div>
    </Card>
  );
}

function ProfitReport({ range }) {
  const { data } = useLoad(`/reports/profit?from=${range.from}&to=${range.to}`, [range.from, range.to]);
  const [sort, setSort] = useState({ k: 'revenue', dir: -1 });
  const rows = useSorted(data?.rows, sort);
  if (!data) return <Spinner />;
  const p = { sort, setSort };
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return (<>
    {data.users_without_rate > 0 && (
      <div className="flex items-center gap-2 text-[13px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3"><AlertTriangle size={15} />
        У {data.users_without_rate} {plural(data.users_without_rate, 'сотрудника', 'сотрудников', 'сотрудников')} не указана ставка в час (Команда → сотрудник) — их время считается бесплатным.</div>
    )}
    {!rows.length ? <Card><Empty icon={PiggyBank} title="Нет данных за период" text="Доходы с привязкой к клиенту и учтённое время появятся здесь" /></Card> : (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-canvas/60 border-b border-line">
              <th className="th">Клиент</th><SortTh k="revenue" right {...p}>Выручка</SortTh><SortTh k="hours" right {...p}>Часы</SortTh><SortTh k="cost" right {...p}>Затраты</SortTh>
              <SortTh k="profit" right {...p}>Прибыль</SortTh><SortTh k="margin" right {...p}>Маржа</SortTh><SortTh k="rate" right {...p}>Выручка за час</SortTh>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="td text-ink font-medium">{r.name}</td>
                  <td className="td text-right tabular">{fmtMoney(r.revenue)}</td>
                  <td className="td text-right tabular">{String(r.hours).replace('.', ',')}</td>
                  <td className="td text-right tabular" title={`Время сотрудников: ${fmtMoney(r.labor_cost)}${r.expenses ? `, расходы: ${fmtMoney(r.expenses)}` : ''}`}>{fmtMoney(r.cost)}</td>
                  <td className={cx('td text-right tabular font-semibold', r.profit < 0 ? 'text-red-600' : 'text-ink')}>{fmtMoney(r.profit)}</td>
                  <td className={cx('td text-right tabular', r.margin != null && r.margin < 20 && 'text-amber-600')}>{r.margin != null ? `${r.margin}%` : '—'}</td>
                  <td className="td text-right tabular">{r.rate ? fmtMoney(r.rate) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-line bg-canvas/40">
              <td className="td font-semibold">Итого</td><td className="td text-right tabular font-semibold">{fmtMoney(sum('revenue'))}</td>
              <td className="td text-right tabular font-semibold">{String(Math.round(sum('hours') * 100) / 100).replace('.', ',')}</td>
              <td className="td text-right tabular font-semibold">{fmtMoney(sum('cost'))}</td>
              <td className={cx('td text-right tabular font-semibold', sum('profit') < 0 && 'text-red-600')}>{fmtMoney(sum('profit'))}</td>
              <td className="td text-right tabular">{sum('revenue') ? `${Math.round((sum('profit') / sum('revenue')) * 100)}%` : '—'}</td><td />
            </tr></tfoot>
          </table>
        </div>
      </Card>
    )}
    <p className="text-[12px] text-ink-3 mt-2">Выручка — доходы в «Финансах» с указанным клиентом (оплаты счетов попадают туда автоматически). Затраты — часы сотрудников × их ставка + расходы с привязкой к клиенту.</p>
  </>);
}

function ClientReportForm({ range }) {
  const { clients, projects } = useApp();
  const { data: companies } = useLoad('/companies');
  const [clientId, setClientId] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const open = () => {
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (clientId) q.set('client_id', clientId); if (projectId) q.set('project_id', projectId); if (companyId) q.set('company_id', companyId);
    window.open(`/report/client?${q}`, '_blank');
  };
  return (
    <Card className="p-6 max-w-[720px]">
      <p className="text-[13px] text-ink-2 mb-4">Документ для клиента: какие работы выполнены за период, сколько часов потрачено, с каким итогом закрыты задачи и заявки. Открывается в новой вкладке — его можно распечатать или сохранить в PDF.</p>
      <div className="grid sm:grid-cols-2 gap-3.5">
        <Field label="Клиент"><Select value={clientId} onChange={setClientId} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="или проект"><Select value={projectId} onChange={setProjectId} placeholder="—" search options={nameOptions(projects)} /></Field>
        <Field label="От компании" className="sm:col-span-2"><Select value={companyId} onChange={setCompanyId} placeholder="По умолчанию" options={nameOptions(companies || [])} /></Field>
      </div>
      <Button className="mt-5" variant="primary" icon={Printer} disabled={!clientId && !projectId} onClick={open}>Сформировать отчёт</Button>
    </Card>
  );
}
