import { useEffect, useMemo, useState } from 'react';
import { Plus, Ticket, Receipt, Monitor, FileText, LogOut, Send, ChevronLeft, ChevronRight, Printer, Clock, CheckCircle2, AlertTriangle, Moon, Sun } from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { api, fileUrl } from '../lib/api';
import { TICKET_STATUS, TICKET_PRIORITY, INVOICE_STATUS } from '../lib/constants';
import { fmtRub, fmtDate, fmtDateTime, timeAgo, plural } from '../lib/format';
import { Button, Card, Empty, Spinner, Drawer, Modal, Field, Select, StatusDot, Tabs, cx } from '../components/ui';
import { ASSET_TYPES, ASSET_STATUS } from './Assets';

const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const shift = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// Личный кабинет клиента: заявки, счета, оборудование, отчёты о работах
export default function Portal() {
  const { user, logout } = useApp();
  const { data: sum, reload: reloadSum } = useLoad('/portal/summary');
  const [tab, setTab] = useStored('crm.portal.tab', 'tickets');
  const [theme, setTheme] = useStored('crm.theme', 'light');
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  return (
    <div className="min-h-full bg-canvas">
      <header className="bg-panel border-b border-line">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          {sum?.company?.logo_file_id ? <img src={fileUrl(sum.company.logo_file_id, true)} alt="" className="h-9 max-w-32 object-contain" />
            : <span className="size-9 rounded-xl bg-brand text-white grid place-items-center font-bold">{(sum?.company?.name || 'IT').replace(/[«»"]/g, '').replace(/^(ООО|АО|ИП)\s*/, '')[0]}</span>}
          <div className="min-w-0">
            <div className="text-[14px] font-semibold truncate">{sum?.client?.name || 'Личный кабинет'}</div>
            <div className="text-[11.5px] text-ink-3 truncate">Обслуживает {sum?.company?.name || '—'}{sum?.company?.phone && ` · ${sum.company.phone}`}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:block text-[13px] text-ink-2">{user.name}</span>
            <button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} className="size-9 grid place-items-center rounded-full hover:bg-canvas text-ink-2" title="Тема">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button onClick={logout} className="size-9 grid place-items-center rounded-full hover:bg-canvas text-ink-2" title="Выйти"><LogOut size={17} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 page-enter">
        {sum && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <Card className="p-4"><div className="text-[12px] text-ink-3">Открытые заявки</div><div className="text-[26px] font-bold mt-1">{sum.tickets.open || 0}</div></Card>
            <Card className={cx('p-4', sum.overdue > 0 && 'border-red-200')}><div className="text-[12px] text-ink-3">К оплате</div><div className="text-[26px] font-bold mt-1 tabular">{fmtRub(sum.debt)}</div>
              {sum.overdue > 0 && <div className="text-[12px] text-red-600 flex items-center gap-1"><AlertTriangle size={12} />просрочено счетов: {sum.overdue}</div>}</Card>
            {sum.contract ? (
              <Card className="p-4"><div className="text-[12px] text-ink-3">Часы в этом месяце</div>
                <div className="text-[26px] font-bold mt-1 tabular">{String(sum.contract.usage.used_hours).replace('.', ',')} <span className="text-[14px] text-ink-3 font-medium">из {sum.contract.hours_limit}</span></div>
                <div className="h-1.5 rounded-full bg-line mt-2 overflow-hidden"><div className={cx('h-full rounded-full', sum.contract.usage.over_hours > 0 ? 'bg-st-stuck' : 'bg-st-done')} style={{ width: `${Math.min(100, sum.contract.usage.pct || 0)}%` }} /></div></Card>
            ) : <Card className="p-4"><div className="text-[12px] text-ink-3">Всего заявок</div><div className="text-[26px] font-bold mt-1">{sum.tickets.total || 0}</div></Card>}
          </div>
        )}
        <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'tickets', label: 'Заявки', icon: Ticket }, { value: 'invoices', label: 'Счета', icon: Receipt },
          { value: 'assets', label: 'Оборудование', icon: Monitor }, { value: 'reports', label: 'Отчёты о работах', icon: FileText }]} /></div>
        {tab === 'tickets' ? <PortalTickets onChanged={reloadSum} /> : tab === 'invoices' ? <PortalInvoices /> : tab === 'assets' ? <PortalAssets /> : <PortalReports />}
      </main>
    </div>
  );
}

function PortalTickets({ onChanged }) {
  const { data, reload } = useLoad('/portal/tickets');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(false);
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="flex justify-end mb-3"><Button variant="primary" icon={Plus} onClick={() => setForm(true)}>Новая заявка</Button></div>
      {!data.length ? <Card><Empty icon={Ticket} title="Заявок пока нет" text="Опишите проблему — мы получим уведомление и возьмём в работу" /></Card> : (
        <Card className="overflow-hidden divide-y divide-line">
          {data.map((t) => (
            <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/50">
              <span className="text-ink-3 tabular w-10 text-[13px]">#{t.id}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-ink font-medium truncate">{t.title}</div>
                <div className="text-[12px] text-ink-3">{timeAgo(t.created_at)}{t.assignee_name && ` · ${t.assignee_name}`}{t.asset_name && ` · ${t.asset_name}`}{t.comments_count > 0 && ` · сообщений: ${t.comments_count}`}</div>
              </div>
              <StatusDot color={TICKET_STATUS[t.status].color} label={TICKET_STATUS[t.status].label} />
            </button>
          ))}
        </Card>
      )}
      {openId && <PortalTicket id={openId} onClose={() => setOpenId(null)} onChanged={() => { reload(); onChanged(); }} />}
      {form && <PortalTicketForm onClose={() => setForm(false)} onSaved={(t) => { reload(); onChanged(); setOpenId(t.id); }} />}
    </div>
  );
}

function PortalTicket({ id, onClose, onChanged }) {
  const { toast } = useApp();
  const [t, setT] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get(`/portal/tickets/${id}`).then(setT).catch((e) => toast(e.message, 'error')); }, [id, toast]);
  const send = async (e) => {
    e.preventDefault();
    if (!msg.trim()) return;
    try { const c = await api.post(`/portal/tickets/${id}/comments`, { body: msg }); setT((x) => ({ ...x, comments: c })); setMsg(''); onChanged(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Drawer open onClose={onClose} width={640} title={t ? `#${t.id} · ${t.title}` : 'Заявка'}>
      {!t ? <Spinner /> : (
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot color={TICKET_STATUS[t.status].color} label={<span className="font-semibold text-ink">{TICKET_STATUS[t.status].label}</span>} />
            <span className="text-[12.5px] text-ink-3">создана {fmtDateTime(t.created_at)}{t.assignee_name && ` · исполнитель: ${t.assignee_name}`}</span>
          </div>
          {t.description && <p className="text-[14px] text-ink whitespace-pre-wrap bg-canvas rounded-xl p-3">{t.description}</p>}
          {t.resolution && <div className="rounded-xl bg-brand/[.06] p-3"><div className="text-[12px] text-brand font-semibold flex items-center gap-1.5 mb-1"><CheckCircle2 size={14} />Решение</div><div className="text-[13.5px] whitespace-pre-wrap">{t.resolution}</div></div>}
          <div>
            <h3 className="text-[14px] font-semibold mb-2.5">Переписка</h3>
            <div className="space-y-2.5">
              {t.comments.map((c) => (
                <div key={c.id} className={cx('flex', c.from_client ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2', c.from_client ? 'bg-brand text-white rounded-br-md' : 'bg-canvas rounded-bl-md')}>
                    <div className={cx('text-[11.5px]', c.from_client ? 'text-white/75' : 'text-ink-3')}>{c.user_name} · {timeAgo(c.created_at)}</div>
                    <div className="text-[13.5px] whitespace-pre-wrap">{c.body}</div>
                  </div>
                </div>
              ))}
              {!t.comments.length && <div className="text-[13px] text-ink-3">Сообщений пока нет — напишите, если есть подробности</div>}
            </div>
            {t.status !== 'closed' && (
              <form onSubmit={send} className="flex items-center gap-2 mt-3">
                <input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Написать сообщение…" />
                <Button variant="primary" icon={Send} type="submit">Отправить</Button>
              </form>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function PortalTicketForm({ onClose, onSaved }) {
  const { toast } = useApp();
  const { data: assets } = useLoad('/portal/assets');
  const [f, setF] = useState({ priority: 'normal' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    if (!f.title?.trim()) return toast('Кратко опишите проблему', 'error');
    try { const t = await api.post('/portal/tickets', { ...f, asset_id: f.asset_id ? +f.asset_id : null }); toast(`Заявка #${t.id} отправлена`); onSaved(t); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Новая заявка" width={560} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Отправить</Button></>}>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Что случилось" className="col-span-2"><input className="input" value={f.title || ''} onChange={set('title')} autoFocus placeholder="Например: не печатает принтер в бухгалтерии" /></Field>
        <Field label="Подробности" className="col-span-2"><textarea className="input" rows={4} value={f.description || ''} onChange={set('description')} placeholder="Что пробовали, какая ошибка, как с вами связаться" /></Field>
        <Field label="Срочность" hint={`Ответим в течение ${TICKET_PRIORITY[f.priority].sla} ч`}><Select value={f.priority} onChange={set('priority')} options={Object.entries(TICKET_PRIORITY).map(([value, p]) => ({ value, label: p.label }))} /></Field>
        <Field label="Где (кабинет, этаж)"><input className="input" value={f.location || ''} onChange={set('location')} /></Field>
        {assets?.length > 0 && <Field label="Устройство" className="col-span-2"><Select value={f.asset_id} onChange={set('asset_id')} placeholder="—" search options={assets.map((a) => ({ value: a.id, label: a.name, hint: a.location }))} /></Field>}
      </div>
    </Modal>
  );
}

function PortalInvoices() {
  const { data } = useLoad('/portal/invoices');
  if (!data) return <Spinner />;
  if (!data.length) return <Card><Empty icon={Receipt} title="Счетов нет" /></Card>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-canvas/60 border-b border-line"><th className="th">№</th><th className="th">Дата</th><th className="th">Назначение</th><th className="th text-right">Сумма</th><th className="th text-right">Оплачено</th><th className="th">Оплатить до</th><th className="th">Статус</th></tr></thead>
          <tbody>
            {data.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="td font-semibold text-ink">{i.number}</td><td className="td">{fmtDate(i.date, true)}</td><td className="td whitespace-normal">{i.title || '—'}</td>
                <td className="td text-right tabular">{fmtRub(i.total)}</td><td className="td text-right tabular">{i.paid ? fmtRub(i.paid) : '—'}</td>
                <td className={cx('td', i.status === 'overdue' && 'text-red-600 font-medium')}>{i.due_date ? fmtDate(i.due_date, true) : '—'}</td>
                <td className="td"><StatusDot color={INVOICE_STATUS[i.status].color} label={INVOICE_STATUS[i.status].label} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PortalAssets() {
  const { data } = useLoad('/portal/assets');
  if (!data) return <Spinner />;
  if (!data.length) return <Card><Empty icon={Monitor} title="Список оборудования пуст" /></Card>;
  return (
    <Card className="overflow-hidden divide-y divide-line">
      {data.map((a) => { const [label, Icon] = ASSET_TYPES[a.type] || ASSET_TYPES.other; return (
        <div key={a.id} className="flex items-center gap-3 px-4 py-3">
          <span className="size-9 rounded-xl bg-canvas border border-line grid place-items-center text-ink-2"><Icon size={16} /></span>
          <div className="flex-1 min-w-0"><div className="text-[14px] text-ink font-medium">{a.name}</div><div className="text-[12px] text-ink-3">{[a.model || label, a.location, a.owner].filter(Boolean).join(' · ')}</div></div>
          {a.warranty_until && <span className="text-[12px] text-ink-3 hidden sm:block">гарантия до {fmtDate(a.warranty_until, true)}</span>}
          <StatusDot color={ASSET_STATUS[a.status]?.color} label={ASSET_STATUS[a.status]?.label} />
        </div>
      ); })}
    </Card>
  );
}

function PortalReports() {
  const [month, setMonth] = useState(curMonth);
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`; const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const { data } = useLoad(`/portal/report?from=${from}&to=${to}`, [from, to]);
  const items = useMemo(() => data?.work || [], [data]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="chip !px-2.5" onClick={() => setMonth((x) => shift(x, -1))}><ChevronLeft size={16} /></button>
        <div className="min-w-36 text-center text-[15px] font-semibold capitalize">{MONTHS[m - 1]} {y}</div>
        <button className="chip !px-2.5" onClick={() => setMonth((x) => shift(x, 1))}><ChevronRight size={16} /></button>
        <Button className="ml-auto" icon={Printer} onClick={() => window.open(`/report/client?from=${from}&to=${to}`, '_blank')}>Отчёт для печати</Button>
      </div>
      {!data ? <Spinner /> : (
        <Card className="p-5">
          <div className="flex flex-wrap gap-6 text-[13px] mb-4">
            <span>Затрачено: <b className="tabular">{String(Math.round((data.total_sec / 3600) * 10) / 10).replace('.', ',')} ч</b></span>
            <span>Закрыто задач: <b>{data.closed.length}</b></span><span>Решено заявок: <b>{data.tickets.length}</b></span>
          </div>
          {!items.length && !data.closed.length ? <div className="text-[13px] text-ink-3">В этом месяце работ не было</div> : (<>
            {data.closed.map((t) => <div key={t.id} className="py-2 border-t border-line"><div className="font-medium text-[13.5px]">{t.title}</div>{t.result && <div className="text-[12.5px] text-ink-2">{t.result}</div>}</div>)}
            {items.map((w, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-t border-line text-[13px]">
                <span className="flex-1">{w.task_title || (w.ticket_id ? `Заявка № ${w.ticket_id}. ${w.ticket_title}` : 'Прочие работы')}</span>
                <span className="text-ink-3 inline-flex items-center gap-1 tabular"><Clock size={12} />{(Math.round((w.sec / 3600) * 10) / 10).toString().replace('.', ',')} ч</span>
              </div>
            ))}
          </>)}
        </Card>
      )}
    </div>
  );
}
