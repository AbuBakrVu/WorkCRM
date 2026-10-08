import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Filter, User, Table2, Kanban, X, MapPin, Clock, Play, MessageSquare, AlertTriangle, Ticket as TicketIcon, Send } from 'lucide-react';
import { useApp, useLoad, useNow, useStored } from '../lib/store';
import { SavedViews } from '../components/SavedViews';
import { HistoryPanel } from '../components/History';
import { api } from '../lib/api';
import { TICKET_STATUS, TICKET_PRIORITY, TICKET_CATEGORY } from '../lib/constants';
import { fmtDateTime, fmtHM, parseDate, timeAgo } from '../lib/format';
import { Button, Tabs, Popover, MenuItem, StatusDot, Pill, Avatar, Card, Empty, Spinner, Drawer, Modal, Field, Select, ConfirmButton, PageHeader, cx, userOptions, nameOptions, SearchList } from '../components/ui';

const OPEN = ['new', 'in_progress', 'waiting'];

export function SlaBadge({ t, now }) {
  if (!t.due_at || !OPEN.includes(t.status)) return null;
  const left = (parseDate(t.due_at) - now) / 1000;
  const human = (s) => (s >= 86400 ? `${Math.floor(s / 86400)} дн ${Math.floor((s % 86400) / 3600)} ч` : s >= 3600 ? `${Math.floor(s / 3600)} ч` : `${Math.max(1, Math.floor(s / 60))} мин`);
  if (left < 0) return <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-red-600 whitespace-nowrap"><AlertTriangle size={12} />просрочено {human(-left)}</span>;
  return <span className={cx('inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap', left < 3600 * 2 ? 'text-amber-600 font-medium' : 'text-ink-3')}><Clock size={12} />{human(left)}</span>;
}

export default function Tickets() {
  const { users, toast, bump } = useApp();
  const { data, loading, setData } = useLoad('/tickets');
  const [params, setParams] = useSearchParams();
  const [view, setView] = useStored('crm.tickets.view', 'table');
  const [scope, setScope] = useStored('crm.tickets.scope', 'open');
  const [q, setQ] = useState('');
  const [assignee, setAssignee] = useState(null);
  const [prio, setPrio] = useState([]);
  const [cat, setCat] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const now = useNow(30000);

  useEffect(() => {
    const o = params.get('open'); if (o) setOpenId(Number(o));
    if (params.get('new')) setFormOpen(true);
    if (o || params.get('new')) setParams({}, { replace: true });
  }, [params, setParams]);

  const all = data || [];
  const list = useMemo(() => all.filter((t) => {
    if (scope === 'open' && !OPEN.includes(t.status)) return false;
    if (scope === 'overdue' && !(OPEN.includes(t.status) && parseDate(t.due_at) < now)) return false;
    if (scope === 'done' && OPEN.includes(t.status)) return false;
    if (q && !`#${t.id} ${t.title} ${t.location || ''} ${t.requester || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (assignee === -1 && t.assignee_id) return false;
    if (assignee > 0 && t.assignee_id !== assignee) return false;
    if (prio.length && !prio.includes(t.priority)) return false;
    if (cat.length && !cat.includes(t.category)) return false;
    return true;
  }), [all, scope, q, assignee, prio, cat, now]);

  const counts = {
    open: all.filter((t) => OPEN.includes(t.status)).length,
    overdue: all.filter((t) => OPEN.includes(t.status) && parseDate(t.due_at) < now).length,
    done: all.filter((t) => !OPEN.includes(t.status)).length,
  };

  const patch = async (id, body) => {
    setData((d) => d.map((t) => (t.id === id ? { ...t, ...body } : t)));
    try { const u = await api.put(`/tickets/${id}`, body); setData((d) => d.map((t) => (t.id === id ? u : t))); bump(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <PageHeader title="Заявки" subtitle="Обращения пользователей: неисправности, доступы, оборудование. Срок реакции считается по приоритету."
        actions={<Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Новая заявка</Button>} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Tabs value={scope} onChange={setScope} tabs={[
            { value: 'open', label: 'Открытые', count: counts.open },
            { value: 'overdue', label: 'Просроченные', count: counts.overdue },
            { value: 'done', label: 'Решённые', count: counts.done },
            { value: 'all', label: 'Все', count: all.length },
          ]} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <div className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-line bg-panel">
          <Search size={15} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Номер, тема, место, заявитель" className="outline-none text-[13px] w-56 bg-transparent" />
          {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
        </div>
        <Popover width={240} trigger={({ toggle }) => (
          <button className={cx('chip', assignee && 'chip-active')} onClick={toggle}><User size={15} />
            {assignee === -1 ? 'Не назначены' : assignee ? users.find((u) => u.id === assignee)?.name.split(' ')[0] : 'Исполнитель'}</button>
        )}>
          {({ close }) => (<>
            <SearchList value={assignee} placeholder="Поиск сотрудника…" onEscape={close}
              items={[{ value: null, label: 'Все', muted: true }, { value: -1, label: 'Не назначены', muted: true }, ...userOptions(users)]} onPick={(v) => { setAssignee(v); close(); }} />
          </>)}
        </Popover>
        <Popover width={220} trigger={({ toggle }) => <button className={cx('chip', (prio.length || cat.length) && 'chip-active')} onClick={toggle}><Filter size={15} />Фильтр{prio.length + cat.length ? ` · ${prio.length + cat.length}` : ''}</button>}>
          <div className="px-2.5 py-1 text-[11.5px] font-medium text-ink-3">Приоритет</div>
          {Object.entries(TICKET_PRIORITY).map(([k, p]) => <MenuItem key={k} checked={prio.includes(k)} onClick={() => setPrio((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}>{p.label}</MenuItem>)}
          <div className="px-2.5 pt-2 py-1 text-[11.5px] font-medium text-ink-3">Категория</div>
          {Object.entries(TICKET_CATEGORY).map(([k, l]) => <MenuItem key={k} checked={cat.includes(k)} onClick={() => setCat((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}>{l}</MenuItem>)}
        </Popover>
        <SavedViews page="tickets" state={{ scope, q, assignee, prio, cat }}
          apply={(v) => { if (v.scope) setScope(v.scope); setQ(v.q || ''); setAssignee(v.assignee ?? null); setPrio(v.prio || []); setCat(v.cat || []); }} />
        <div className="ml-auto flex items-center gap-1 p-0.5 rounded-full border border-line bg-panel">
          {[['table', Table2, 'Таблица'], ['kanban', Kanban, 'Канбан']].map(([v, I, l]) => (
            <button key={v} onClick={() => setView(v)} className={cx('flex items-center gap-1.5 px-3 h-8 rounded-full text-[12.5px] font-medium', view === v ? 'bg-ink text-white' : 'text-ink-2')}><I size={14} />{l}</button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {loading && !data ? <Spinner /> : list.length === 0 && view === 'table' ? (
          <Card><Empty icon={TicketIcon} title="Заявок нет" text="Здесь появятся обращения пользователей" action={<Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Новая заявка</Button>} /></Card>
        ) : view === 'table' ? (
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-canvas/60">
                <th className="th w-16">№</th><th className="th min-w-[240px]">Тема</th><th className="th">Приоритет</th><th className="th">Статус</th>
                <th className="th">Место</th><th className="th">Исполнитель</th><th className="th">Срок реакции</th>
              </tr></thead>
              <tbody>
                {list.map((t) => {
                  const pr = TICKET_PRIORITY[t.priority]; const st = TICKET_STATUS[t.status];
                  return (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-canvas/50">
                      <td className="td text-ink-3 tabular">#{t.id}</td>
                      <td className="td">
                        <button onClick={() => setOpenId(t.id)} className="text-ink hover:text-violet text-left">{t.title}</button>
                        <div className="text-[11.5px] text-ink-3 flex items-center gap-2 mt-0.5">
                          {TICKET_CATEGORY[t.category]}{t.requester && <> · {t.requester}</>} · {timeAgo(t.created_at)}
                          {t.comments_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{t.comments_count}</span>}
                        </div>
                      </td>
                      <td className="td"><Pill color={pr.color} bg={pr.bg}>{pr.label}</Pill></td>
                      <td className="td">
                        <Popover width={180} trigger={({ toggle }) => <button onClick={toggle}><StatusDot color={st.color} label={st.label} /></button>}>
                          {({ close }) => Object.entries(TICKET_STATUS).map(([k, s]) => <MenuItem key={k} checked={k === t.status} onClick={() => { patch(t.id, { status: k }); close(); }}><StatusDot color={s.color} label={s.label} /></MenuItem>)}
                        </Popover>
                      </td>
                      <td className="td max-w-[200px] truncate">{t.location || '—'}</td>
                      <td className="td">
                        <Popover width={220} trigger={({ toggle }) => (
                          <button onClick={toggle} className="flex items-center gap-2">
                            <Avatar user={users.find((u) => u.id === t.assignee_id)} size={22} ring={false} />
                            <span className={t.assignee_id ? '' : 'text-ink-3'}>{t.assignee_name?.split(' ')[0] || 'Назначить'}</span>
                          </button>
                        )}>
                          {({ close }) => <SearchList value={t.assignee_id} placeholder="Поиск сотрудника…" onEscape={close} items={userOptions(users)}
                            onPick={(id) => { patch(t.id, { assignee_id: id, ...(t.status === 'new' ? { status: 'in_progress' } : {}) }); close(); }} />}
                        </Popover>
                      </td>
                      <td className="td"><SlaBadge t={t} now={now} />{!OPEN.includes(t.status) && <span className="text-ink-3 text-[12px]">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <TicketKanban tickets={list} now={now} onOpen={setOpenId} onPatch={patch} scope={scope} />
        )}
      </div>

      <TicketDrawer id={openId} onClose={() => setOpenId(null)} />
      <TicketFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={(t) => { bump(); setOpenId(t.id); }} />
    </div>
  );
}

function TicketKanban({ tickets, now, onOpen, onPatch, scope }) {
  const [dragId, setDragId] = useState(null);
  const statuses = scope === 'open' || scope === 'overdue' ? OPEN : Object.keys(TICKET_STATUS);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {statuses.map((s) => {
        const items = tickets.filter((t) => t.status === s);
        const st = TICKET_STATUS[s];
        return (
          <div key={s} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) onPatch(dragId, { status: s }); setDragId(null); }}
            className="w-[290px] shrink-0 rounded-2xl border border-line bg-canvas/70 p-2.5">
            <div className="flex items-center justify-between px-1.5 pb-2.5"><StatusDot color={st.color} label={<b className="font-medium text-ink">{st.label}</b>} /><span className="text-[12px] text-ink-3">{items.length}</span></div>
            <div className="space-y-2 min-h-16">
              {items.map((t) => {
                const pr = TICKET_PRIORITY[t.priority];
                return (
                  <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onClick={() => onOpen(t.id)}
                    className="bg-panel rounded-xl border border-line p-3 cursor-pointer hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-ink-3 tabular">#{t.id} · {TICKET_CATEGORY[t.category]}</span>
                      <Pill color={pr.color} bg={pr.bg} className="h-5 text-[11px]">{pr.label}</Pill>
                    </div>
                    <div className="text-[13.5px] font-medium mt-1.5 leading-snug">{t.title}</div>
                    {t.location && <div className="flex items-center gap-1 text-[12px] text-ink-3 mt-1"><MapPin size={12} />{t.location}</div>}
                    <div className="flex items-center justify-between mt-3">
                      <span className="flex items-center gap-1.5 text-[12px] text-ink-2">{t.assignee_name ? <><Avatar user={{ name: t.assignee_name, color: t.assignee_color }} size={20} ring={false} />{t.assignee_name.split(' ')[0]}</> : <span className="text-ink-3">Не назначена</span>}</span>
                      <SlaBadge t={t} now={now} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TicketFormModal({ open, onClose, onSaved }) {
  const { users, clients, projects, toast } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (open) setF({ title: '', priority: 'normal', category: 'other' }); }, [open]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title?.trim()) return toast('Укажите тему заявки', 'error');
    try {
      const t = await api.post('/tickets', { ...f, client_id: f.client_id ? +f.client_id : null, project_id: f.project_id ? +f.project_id : null,
        assignee_id: f.assignee_id ? +f.assignee_id : null, status: f.assignee_id ? 'in_progress' : 'new' });
      toast(`Заявка #${t.id} создана`); onSaved?.(t); onClose();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новая заявка" width={600}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Создать заявку</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Тема" className="col-span-2"><input className="input" value={f.title || ''} onChange={(e) => set('title')(e.target.value)} autoFocus placeholder="Кратко: что случилось" /></Field>
        <Field label="Приоритет" hint={`Срок реакции: ${TICKET_PRIORITY[f.priority || 'normal'].sla} ч`}>
          <Select value={f.priority} onChange={set('priority')} options={Object.entries(TICKET_PRIORITY).map(([value, p]) => ({ value, label: p.label }))} />
        </Field>
        <Field label="Категория"><Select value={f.category} onChange={set('category')} options={Object.entries(TICKET_CATEGORY).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Место (корпус, кабинет)"><input className="input" value={f.location || ''} onChange={(e) => set('location')(e.target.value)} placeholder="Корпус №2, ауд. 214" /></Field>
        <Field label="Заявитель"><input className="input" value={f.requester || ''} onChange={(e) => set('requester')(e.target.value)} /></Field>
        <Field label="Контакт заявителя"><input className="input" value={f.requester_contact || ''} onChange={(e) => set('requester_contact')(e.target.value)} placeholder="Телефон или email" /></Field>
        <Field label="Исполнитель"><Select value={f.assignee_id} onChange={set('assignee_id')} placeholder="Не назначен" search options={userOptions(users)} /></Field>
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="Проект"><Select value={f.project_id} onChange={set('project_id')} placeholder="—" search options={nameOptions(projects)} /></Field>
        <Field label="Описание" className="col-span-2"><textarea className="input" rows={3} value={f.description || ''} onChange={(e) => set('description')(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function TicketDrawer({ id, onClose }) {
  const { users, clients, projects, toast, bump, startTimer, isManager, version } = useApp();
  const [t, setT] = useState(null);
  const [comment, setComment] = useState('');
  const now = useNow(30000);
  useEffect(() => { if (id) api.get(`/tickets/${id}`).then(setT).catch((e) => toast(e.message, 'error')); else setT(null); }, [id, version, toast]);
  if (!id) return null;
  const patch = async (body) => {
    setT((x) => ({ ...x, ...body }));
    try { await api.put(`/tickets/${id}`, body); bump(); } catch (e) { toast(e.message, 'error'); }
  };
  const send = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    const c = await api.post(`/tickets/${id}/comments`, { body: comment });
    setT((x) => ({ ...x, comments: c })); setComment('');
  };
  const remove = async () => { await api.del(`/tickets/${id}`); toast('Заявка удалена'); bump(); onClose(); };
  return (
    <Drawer open={!!id} onClose={onClose} width={680} title={t ? `#${t.id} · ${t.title}` : 'Заявка'}
      actions={t && <Button size="sm" icon={Play} onClick={() => startTimer({ ticket_id: t.id, description: t.title })}>Таймер</Button>}>
      {!t ? <Spinner /> : (
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill color={TICKET_PRIORITY[t.priority].color} bg={TICKET_PRIORITY[t.priority].bg}>{TICKET_PRIORITY[t.priority].label}</Pill>
            <Pill color="#4b5262" bg="#eef0f3">{TICKET_CATEGORY[t.category]}</Pill>
            <SlaBadge t={t} now={now} />
            <span className="text-[12px] text-ink-3 ml-auto">Создана {fmtDateTime(t.created_at)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Статус"><Select value={t.status} onChange={(v) => patch({ status: v })} options={Object.entries(TICKET_STATUS).map(([value, s]) => ({ value, label: s.label }))} /></Field>
            <Field label="Исполнитель"><Select value={t.assignee_id} onChange={(v) => patch({ assignee_id: v ? +v : null })} placeholder="Не назначен" search options={userOptions(users)} /></Field>
            <Field label="Приоритет"><Select value={t.priority} onChange={(v) => patch({ priority: v })} options={Object.entries(TICKET_PRIORITY).map(([value, p]) => ({ value, label: p.label }))} /></Field>
            <Field label="Категория"><Select value={t.category} onChange={(v) => patch({ category: v })} options={Object.entries(TICKET_CATEGORY).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Место"><input className="input" defaultValue={t.location || ''} onBlur={(e) => e.target.value !== (t.location || '') && patch({ location: e.target.value })} /></Field>
            <Field label="Заявитель"><input className="input" defaultValue={t.requester || ''} onBlur={(e) => e.target.value !== (t.requester || '') && patch({ requester: e.target.value })} /></Field>
            <Field label="Клиент"><Select value={t.client_id} onChange={(v) => patch({ client_id: v ? +v : null })} placeholder="—" search options={nameOptions(clients)} /></Field>
            <Field label="Проект"><Select value={t.project_id} onChange={(v) => patch({ project_id: v ? +v : null })} placeholder="—" search options={nameOptions(projects)} /></Field>
          </div>
          {t.requester_contact && <div className="text-[13px] text-ink-2">Контакт: {t.requester_contact}</div>}
          <Field label="Описание"><textarea className="input" rows={3} defaultValue={t.description || ''} onBlur={(e) => e.target.value !== (t.description || '') && patch({ description: e.target.value })} /></Field>
          {['resolved', 'closed'].includes(t.status) && (
            <Field label="Решение"><textarea className="input" rows={2} defaultValue={t.resolution || ''} placeholder="Что было сделано" onBlur={(e) => patch({ resolution: e.target.value })} /></Field>
          )}
          <div className="text-[12.5px] text-ink-3">Затрачено времени: <b className="text-ink tabular">{fmtHM(t.tracked_sec)} ч</b></div>

          <div>
            <h3 className="text-[14px] font-semibold mb-2.5">Комментарии</h3>
            <div className="space-y-3">
              {t.comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar user={{ name: c.user_name || '?', color: c.user_color }} size={28} ring={false} />
                  <div className="flex-1 bg-canvas rounded-xl px-3 py-2">
                    <div className="text-[12px]"><b className="font-medium">{c.user_name}</b> <span className="text-ink-3">{timeAgo(c.created_at)}</span></div>
                    <div className="text-[13px] text-ink-2 mt-0.5 whitespace-pre-wrap">{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="flex items-center gap-2 mt-3">
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Написать комментарий…" />
              <Button variant="dark" icon={Send} type="submit">Отправить</Button>
            </form>
          </div>
          <HistoryPanel entity="ticket" id={t.id} />
          {isManager && <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить заявку</ConfirmButton></div>}
        </div>
      )}
    </Drawer>
  );
}
