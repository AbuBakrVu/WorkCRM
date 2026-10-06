import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { FolderKanban, Ticket, Timer, Wallet, AlertTriangle, ArrowUpRight, ArrowDownRight, CheckCircle2 } from 'lucide-react';
import { useApp, useLoad, useNow } from '../lib/store';
import { DEAL_STAGE, TICKET_PRIORITY, TICKET_CATEGORY } from '../lib/constants';
import { fmtHours, fmtMoneyShort, fmtMoney, fmtDate, timeAgo, MONTHS, parseDate, toDateStr } from '../lib/format';
import { Card, Stat, Avatar, Pill, Spinner, PageHeader, Button, cx } from '../components/ui';
import { SlaBadge } from './Tickets';

export const C_INCOME = '#4fae3d';
export const C_EXPENSE = '#8b7ff5';

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

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };

export default function Dashboard() {
  const { user, isManager } = useApp();
  const { data: d } = useLoad('/dashboard');
  const now = useNow(60000);
  if (!d) return <Spinner />;

  const weekTotal = d.hours_week.reduce((a, u) => a + u.sec, 0);
  const maxUser = Math.max(1, ...d.hours_week.map((u) => u.sec));
  const fin = d.finance;
  const profit = fin ? fin.month.income - fin.month.expense : 0;
  const delta = fin && fin.prev.income ? Math.round(((fin.month.income - fin.prev.income) / fin.prev.income) * 100) : null;
  const pipeOpen = d.pipeline.filter((p) => !['won', 'lost'].includes(p.stage));
  const pipeSum = pipeOpen.reduce((a, p) => a + p.amount, 0);
  const finChart = (fin?.months || []).map((m) => ({ ...m, label: MONTHS[+m.month.slice(5) - 1].slice(0, 3) }));

  // часы по дням за 14 дней
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    const key = toDateStr(dt);
    const row = d.hours_by_day.find((x) => x.day === key);
    days.push({ label: `${dt.getDate()}`, hours: Math.round(((row?.sec || 0) / 3600) * 10) / 10, weekend: [0, 6].includes(dt.getDay()) });
  }

  return (
    <div>
      <PageHeader title={`${greet()}, ${user.name.split(' ')[0]}`} subtitle="Сводка по проектам, заявкам, времени и деньгам"
        actions={<><Link to="/tickets?new=1"><Button icon={Ticket}>Новая заявка</Button></Link><Link to="/projects?new=1"><Button variant="primary" icon={FolderKanban}>Новый проект</Button></Link></>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Активные проекты" value={d.projects.active || 0} icon={FolderKanban} tone="violet"
          sub={d.projects.stuck ? `${d.projects.stuck} застрял · ${d.projects.overdue || 0} просрочено` : `${d.projects.overdue || 0} просрочено`} />
        <Stat label="Открытые заявки" value={d.tickets.open || 0} icon={Ticket} tone={d.tickets.overdue ? 'red' : 'default'}
          sub={<span className={d.tickets.overdue ? 'text-red-600' : ''}>{d.tickets.overdue || 0} с нарушением срока · {d.tickets.new || 0} новых</span>} />
        <Stat label="Часы за 7 дней" value={fmtHours(weekTotal)} icon={Timer} tone="amber" sub={`${d.tickets.resolved_week || 0} заявок решено за неделю`} />
        {fin ? (
          <Stat label="Прибыль за месяц" value={fmtMoneyShort(profit)} icon={Wallet} tone={profit >= 0 ? 'green' : 'red'}
            sub={delta != null && <span className={cx('inline-flex items-center gap-0.5', delta >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}доход {delta >= 0 ? '+' : ''}{delta}% к прошлому месяцу</span>} />
        ) : (
          <Stat label="Сделки в работе" value={fmtMoneyShort(pipeSum)} icon={Wallet} tone="green" sub={`${pipeOpen.reduce((a, p) => a + p.n, 0)} сделок`} />
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mt-3">
        {/* Срочные заявки */}
        <Card className="lg:col-span-2 min-w-0">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-[15px] font-semibold">Срочные заявки</h2>
            <Link to="/tickets" className="text-[12.5px] text-violet font-medium">Все заявки →</Link>
          </div>
          <div className="px-2 pb-2">
            {d.urgent_tickets.length === 0 && <div className="flex items-center gap-2 px-3 py-6 text-ink-3 text-[13px]"><CheckCircle2 size={16} className="text-emerald-500" />Открытых заявок нет</div>}
            {d.urgent_tickets.map((t) => (
              <Link key={t.id} to={`/tickets?open=${t.id}`} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-canvas">
                <Pill color={TICKET_PRIORITY[t.priority].color} bg={TICKET_PRIORITY[t.priority].bg} className="w-[86px] justify-center shrink-0">{TICKET_PRIORITY[t.priority].label}</Pill>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] truncate">{t.title}</div>
                  <div className="text-[11.5px] text-ink-3 truncate">#{t.id} · {TICKET_CATEGORY[t.category]}{t.location ? ` · ${t.location}` : ''}</div>
                </div>
                <span className="hidden sm:inline"><SlaBadge t={t} now={now} /></span>
                <Avatar user={t.assignee_name ? { name: t.assignee_name, color: t.assignee_color } : null} size={26} ring={false} />
              </Link>
            ))}
          </div>
        </Card>

        {/* Мои задачи */}
        <Card>
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-[15px] font-semibold">Мои задачи</h2>
            <span className="text-[12px] text-ink-3">{d.my_tasks.length}</span>
          </div>
          <div className="px-2 pb-2">
            {d.my_tasks.length === 0 && <div className="px-3 py-6 text-ink-3 text-[13px]">Нет назначенных задач</div>}
            {d.my_tasks.map((t) => {
              const overdue = t.due_date && parseDate(t.due_date) < new Date(new Date().toDateString());
              return (
                <Link key={t.id} to={`/projects?open=${t.project_id}`} className="block px-3 py-2 rounded-xl hover:bg-canvas">
                  <div className="text-[13px] truncate">{t.title}</div>
                  <div className="flex justify-between text-[11.5px] text-ink-3"><span className="truncate">{t.project_name}</span>
                    {t.due_date && <span className={cx('shrink-0 ml-2', overdue && 'text-red-600 font-medium')}>{overdue && <AlertTriangle size={11} className="inline mr-0.5 -mt-0.5" />}{fmtDate(t.due_date)}</span>}</div>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mt-3">
        {/* Финансы */}
        {fin ? (
          <Card className="lg:col-span-2 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[15px] font-semibold">Доходы и расходы</h2>
              <Legend items={[[C_INCOME, 'Доход'], [C_EXPENSE, 'Расход']]} />
            </div>
            <div className="text-[12px] text-ink-3 mb-3">За 6 месяцев · в этом месяце: доход {fmtMoneyShort(fin.month.income)}, расход {fmtMoneyShort(fin.month.expense)}</div>
            <div className="h-[230px]">
              <ResponsiveContainer>
                <BarChart data={finChart} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="#eceef2" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#8a91a0' }} />
                  <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11.5, fill: '#8a91a0' }} tickFormatter={(v) => fmtMoneyShort(v).replace(' ₽', '')} />
                  <Tooltip cursor={{ fill: '#f6f7f9' }} content={<ChartTip money />} />
                  <Bar dataKey="income" name="Доход" fill={C_INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="expense" name="Расход" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ) : (
          <Card className="lg:col-span-2 p-5">
            <h2 className="text-[15px] font-semibold mb-3">Часы команды за 14 дней</h2>
            <HoursChart days={days} />
          </Card>
        )}

        {/* Часы по сотрудникам */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold">Загрузка за неделю</h2>
            <Link to="/time" className="text-[12.5px] text-violet font-medium">Учёт →</Link>
          </div>
          <div className="space-y-3">
            {d.hours_week.map((u) => (
              <div key={u.id} className="flex items-center gap-2.5">
                <Avatar user={u} size={26} ring={false} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-[12.5px]"><span className="truncate">{u.name}</span><span className="text-ink-2 tabular">{fmtHours(u.sec)}</span></div>
                  <div className="h-1.5 bg-line rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(u.sec / maxUser) * 100}%`, background: u.color }} /></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mt-3">
        {fin && (
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold mb-3">Часы команды за 14 дней</h2>
            <HoursChart days={days} />
          </Card>
        )}
        {/* Воронка */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold">Воронка сделок</h2>
            <Link to="/pipeline" className="text-[12.5px] text-violet font-medium">Открыть →</Link>
          </div>
          <div className="space-y-2.5">
            {Object.entries(DEAL_STAGE).map(([k, s]) => {
              const row = d.pipeline.find((p) => p.stage === k) || { n: 0, amount: 0 };
              const max = Math.max(1, ...d.pipeline.map((p) => p.amount));
              return (
                <div key={k}>
                  <div className="flex justify-between text-[12.5px]"><span className="text-ink-2">{s.label} <span className="text-ink-3">· {row.n}</span></span><span className="tabular">{fmtMoneyShort(row.amount)}</span></div>
                  <div className="h-1.5 bg-line rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(row.amount / max) * 100}%`, background: s.color }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        {/* Активность */}
        <Card className={cx('p-5', !fin && 'lg:col-span-2')}>
          <h2 className="text-[15px] font-semibold mb-3">Активность</h2>
          <div className="space-y-3">
            {d.activity.slice(0, 7).map((a) => (
              <div key={a.id} className="flex gap-2.5 text-[12.5px]">
                <Avatar user={{ name: a.user_name || '?', color: a.user_color }} size={24} ring={false} />
                <div className="min-w-0"><span className="font-medium">{a.user_name}</span> <span className="text-ink-2">{a.text}</span>
                  <div className="text-[11px] text-ink-3">{timeAgo(a.created_at)}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function HoursChart({ days }) {
  return (
    <div className="h-[200px]">
      <ResponsiveContainer>
        <BarChart data={days} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="#eceef2" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8a91a0' }} />
          <YAxis tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11, fill: '#8a91a0' }} />
          <Tooltip cursor={{ fill: '#f6f7f9' }} content={<ChartTip />} />
          <Bar dataKey="hours" name="Часы" fill="#8b7ff5" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
