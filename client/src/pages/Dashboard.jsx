import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import {
  ListTodo, AlertTriangle, CheckCircle2, Timer, FolderKanban, Ticket, Plus, UserX, CalendarClock,
} from 'lucide-react';
import { useApp, useLoad, useNow } from '../lib/store';
import { DEAL_STAGE, TICKET_PRIORITY, TICKET_CATEGORY } from '../lib/constants';
import { fmtHours, fmtMoneyShort, fmtMoney, fmtDate, timeAgo, MONTHS, toDateStr, todayStr } from '../lib/format';
import { Card, Stat, Avatar, Pill, Spinner, PageHeader, Button, cx } from '../components/ui';
import { TaskStatusPill } from '../components/Tasks';
import { SlaBadge } from './Tickets';
import { TimerCard } from '../components/TimerCard';

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

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };

function CardHead({ title, link, to, extra }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {extra}{link && <Link to={to} className="text-[12.5px] text-violet font-medium whitespace-nowrap">{link} →</Link>}
    </div>
  );
}

export default function Dashboard() {
  const { user, isManager } = useApp();
  const { data: d } = useLoad('/dashboard');
  const now = useNow(60000);
  const nav = useNavigate();
  if (!d) return <Spinner />;

  const t = d.tasks || {};
  const today = todayStr();
  const weekTotal = d.hours_week.reduce((a, u) => a + u.sec, 0);
  const maxUser = Math.max(1, ...d.hours_week.map((u) => u.sec));

  // Задачи за 14 дней: создано / закрыто
  const taskDays = [];
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    const key = toDateStr(dt);
    taskDays.push({
      label: `${dt.getDate()}`,
      created: d.tasks_created_by_day.find((x) => x.day === key)?.n || 0,
      done: d.tasks_done_by_day.find((x) => x.day === key)?.n || 0,
    });
  }
  const fin = d.finance;
  const finChart = (fin?.months || []).map((m) => ({ ...m, label: MONTHS[+m.month.slice(5) - 1].slice(0, 3) }));

  return (
    <div>
      <PageHeader title={`${greet()}, ${user.name.split(' ')[0]}`} subtitle="Общая картина по проектам, задачам и времени команды"
        actions={<>
          <Link to="/tickets?new=1"><Button icon={Ticket}>Заявка</Button></Link>
          <Link to="/projects?newtask=1"><Button variant="primary" icon={Plus}>Задача</Button></Link>
        </>} />

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
        <Stat featured to="/projects" label="Открытые задачи" value={t.open || 0}
          sub={`${t.in_progress || 0} в работе · ${t.unassigned || 0} без исполнителя`} />
        <Stat to="/projects" label="Просрочено" value={t.overdue || 0} tone={t.overdue ? 'red' : undefined}
          sub={<span className={t.due_soon ? 'text-amber-600' : ''}>{t.due_soon || 0} со сроком в ближайшие 3 дня</span>} />
        <Stat to="/projects" label="Закрыто за неделю" value={t.done_week || 0} sub={`создано за неделю: ${t.created_week || 0}`} />
        <Stat to="/time" label="Часы за 7 дней" value={fmtHours(weekTotal)}
          sub={`открытых заявок: ${d.tickets.open || 0}${d.tickets.overdue ? ` · ${d.tickets.overdue} просрочено` : ''}`} />
      </div>

      {/* Проекты + внимание */}
      <div className="grid lg:grid-cols-3 gap-3 mt-3 stagger">
        <Card className="lg:col-span-2 min-w-0">
          <CardHead title="Проекты" link="Все проекты" to="/projects" />
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full">
              <thead><tr className="text-[12px] text-ink-3">
                <th className="text-left font-medium px-3 py-2">Организация</th>
                <th className="text-right font-medium px-2 py-2">Открыто</th>
                <th className="text-right font-medium px-2 py-2">В работе</th>
                <th className="text-right font-medium px-2 py-2">Просрочено</th>
                <th className="text-right font-medium px-2 py-2">Закрыто</th>
                <th className="text-left font-medium px-3 py-2 w-[130px]">Прогресс</th>
                <th className="text-right font-medium px-3 py-2">Часы/нед</th>
              </tr></thead>
              <tbody>
                {d.projects_overview.map((p) => {
                  const open = (p.todo || 0) + (p.in_progress || 0);
                  const prog = p.total ? Math.round(((p.done || 0) / p.total) * 100) : 0;
                  return (
                    <tr key={p.id} onClick={() => nav(`/projects?open=${p.id}`)} className="cursor-pointer hover:bg-canvas text-[13px]">
                      <td className="px-3 py-2.5 rounded-l-xl font-medium text-ink max-w-[220px] truncate">{p.name}</td>
                      <td className="px-2 py-2.5 text-right tabular">{open || <span className="text-ink-3">0</span>}</td>
                      <td className="px-2 py-2.5 text-right tabular">{p.in_progress || <span className="text-ink-3">0</span>}</td>
                      <td className={cx('px-2 py-2.5 text-right tabular', p.overdue ? 'text-red-600 font-semibold' : 'text-ink-3')}>{p.overdue || 0}</td>
                      <td className="px-2 py-2.5 text-right tabular text-ink-2">{p.done || 0}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full rounded-full bg-st-done" style={{ width: `${prog}%` }} /></div>
                          <span className="text-[11.5px] text-ink-3 tabular w-8 text-right">{prog}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 rounded-r-xl text-right tabular text-ink-2">{p.week_sec ? fmtHours(p.week_sec) : <span className="text-ink-3">—</span>}</td>
                    </tr>
                  );
                })}
                {!d.projects_overview.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-3 text-[13px]">Проектов нет</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="min-w-0">
          <CardHead title="Требуют внимания" extra={<span className="text-[12px] text-ink-3">{d.attention_tasks.length}</span>} />
          <div className="px-2 pb-2">
            {d.attention_tasks.length === 0 && <div className="flex items-center gap-2 px-3 py-6 text-ink-3 text-[13px]"><CheckCircle2 size={16} className="text-emerald-500" />Всё под контролем</div>}
            {d.attention_tasks.map((x) => {
              const late = x.due_date && x.due_date < today;
              const reason = late ? { icon: AlertTriangle, text: `просрочено, срок ${fmtDate(x.due_date)}`, cls: 'text-red-600' }
                : x.due_date ? { icon: CalendarClock, text: `срок ${x.due_date === today ? 'сегодня' : fmtDate(x.due_date)}`, cls: 'text-amber-600' }
                : { icon: UserX, text: 'нет исполнителя', cls: 'text-ink-3' };
              return (
                <Link key={x.id} to={`/projects?open=${x.project_id}&task=${x.id}`} className="block px-3 py-2 rounded-xl hover:bg-canvas">
                  <div className="text-[13px] truncate">{x.title}</div>
                  <div className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="text-ink-3 truncate">{x.project_name}</span>
                    <span className={cx('inline-flex items-center gap-1 shrink-0', reason.cls)}><reason.icon size={11} />{reason.text}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Динамика задач + таймер */}
      <div className="grid lg:grid-cols-3 gap-3 mt-3 stagger">
        <Card className="lg:col-span-2 p-5 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold">Задачи за 14 дней</h2>
            <Legend items={[[C_EXPENSE, 'Создано'], [C_INCOME, 'Закрыто']]} />
          </div>
          <div className="h-[210px]">
            <ResponsiveContainer>
              <BarChart data={taskDays} barGap={2} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-ink-3)' }} />
                <YAxis tickLine={false} axisLine={false} width={24} allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-ink-3)' }} />
                <Tooltip cursor={{ fill: 'var(--color-canvas)' }} content={<ChartTip />} />
                <Bar dataKey="created" name="Создано" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Bar dataKey="done" name="Закрыто" fill={C_INCOME} radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <TimerCard />
      </div>

      {/* Мои задачи / заявки / часы */}
      <div className="grid lg:grid-cols-3 gap-3 mt-3 stagger">
        <Card className="min-w-0">
          <CardHead title="Мои задачи" extra={<span className="text-[12px] text-ink-3">{d.my_tasks.length}</span>} />
          <div className="px-2 pb-2">
            {d.my_tasks.length === 0 && <div className="px-3 py-6 text-ink-3 text-[13px]">Нет назначенных задач</div>}
            {d.my_tasks.map((x) => (
              <Link key={x.id} to={`/projects?open=${x.project_id}&task=${x.id}`} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-canvas">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate">{x.title}</div>
                  <div className="text-[11.5px] text-ink-3 truncate">{x.project_name}{x.due_date ? ` · до ${fmtDate(x.due_date)}` : ''}</div>
                </div>
                <TaskStatusPill status={x.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card className="min-w-0">
          <CardHead title="Срочные заявки" link="Все" to="/tickets" />
          <div className="px-2 pb-2">
            {d.urgent_tickets.length === 0 && <div className="flex items-center gap-2 px-3 py-6 text-ink-3 text-[13px]"><CheckCircle2 size={16} className="text-emerald-500" />Открытых заявок нет</div>}
            {d.urgent_tickets.slice(0, 5).map((x) => (
              <Link key={x.id} to={`/tickets?open=${x.id}`} className="block px-3 py-2 rounded-xl hover:bg-canvas">
                <div className="flex items-center gap-2">
                  <Pill color={TICKET_PRIORITY[x.priority].color} bg={TICKET_PRIORITY[x.priority].bg} className="h-5 text-[11px] shrink-0">{TICKET_PRIORITY[x.priority].label}</Pill>
                  <span className="text-[13px] truncate">{x.title}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5 text-[11.5px] text-ink-3">
                  <span className="truncate">#{x.id} · {TICKET_CATEGORY[x.category]}</span><SlaBadge t={x} now={now} />
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold">Часы за неделю</h2>
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

      {/* Деньги — только админ и менеджер */}
      {isManager && fin && (
        <div className="grid lg:grid-cols-3 gap-3 mt-3">
          <Card className="lg:col-span-2 p-5 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[15px] font-semibold">Доходы и расходы</h2>
              <Legend items={[[C_INCOME, 'Доход'], [C_EXPENSE, 'Расход']]} />
            </div>
            <div className="text-[12px] text-ink-3 mb-3">В этом месяце: доход {fmtMoneyShort(fin.month.income)}, расход {fmtMoneyShort(fin.month.expense)}, прибыль {fmtMoneyShort(fin.month.income - fin.month.expense)}</div>
            <div className="h-[200px]">
              <ResponsiveContainer>
                <BarChart data={finChart} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-ink-3)' }} />
                  <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11.5, fill: 'var(--color-ink-3)' }} tickFormatter={(v) => fmtMoneyShort(v).replace(' ₽', '')} />
                  <Tooltip cursor={{ fill: 'var(--color-canvas)' }} content={<ChartTip money />} />
                  <Bar dataKey="income" name="Доход" fill={C_INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="expense" name="Расход" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
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
        </div>
      )}
    </div>
  );
}
