import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Ticket, Plus, UserX, CalendarClock } from 'lucide-react';
import { useApp, useLoad, useNow } from '../lib/store';
import { TICKET_PRIORITY, TICKET_CATEGORY } from '../lib/constants';
import { fmtHours, fmtMoneyShort, fmtDate, todayStr } from '../lib/format';
import { Card, Stat, Pill, Spinner, PageHeader, Button, cx } from '../components/ui';
import { TaskStatusPill } from '../components/Tasks';
import { SlaBadge } from './Tickets';
import { TimerCard } from '../components/TimerCard';

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
  const inv = d.invoices;
  const myWeek = d.my_week_sec || 0;

  return (
    <div>
      <PageHeader title={`${greet()}, ${user.name.split(' ')[0]}`} subtitle="Что требует внимания сегодня"
        actions={<>
          <Link to="/tickets?new=1"><Button icon={Ticket}>Заявка</Button></Link>
          <Link to="/projects?newtask=1"><Button variant="primary" icon={Plus}>Задача</Button></Link>
        </>} />

      {/* KPI — только то, что требует действий сегодня */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
        <Stat featured to="/projects" label="Открытые задачи" value={t.open || 0}
          sub={`${t.in_progress || 0} в работе · ${t.unassigned || 0} без исполнителя`} />
        <Stat to="/projects" label="Просрочено" value={t.overdue || 0} tone={t.overdue ? 'red' : undefined}
          sub={<span className={t.due_soon ? 'text-amber-600' : ''}>{t.due_soon || 0} со сроком в ближайшие 3 дня</span>} />
        <Stat to="/tickets" label="Открытые заявки" value={d.tickets.open || 0} tone={d.tickets.overdue ? 'red' : undefined}
          sub={d.tickets.overdue ? `${d.tickets.overdue} просрочено по SLA` : 'просроченных нет'} />
        {isManager && inv ? (
          <Stat to="/finance/invoices" label="Ждём оплату" value={fmtMoneyShort(inv.unpaid_sum)} tone={inv.overdue ? 'red' : undefined}
            sub={inv.overdue ? `${inv.overdue} просрочено на ${fmtMoneyShort(inv.overdue_sum)}` : `${inv.unpaid} счетов, просроченных нет`} />
        ) : (
          <Stat to="/projects?view=time" label="Мои часы за неделю" value={fmtHours(myWeek)} sub="по учёту времени" />
        )}
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

      {/* Мои задачи / заявки / таймер */}
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

        <TimerCard />
      </div>
    </div>
  );
}
