import { useEffect, useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, Clock, Pencil, FileClock, Printer } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { fmtRub, fmtDate, fmtHM, plural } from '../lib/format';
import { Button, Card, Empty, Spinner, Drawer, Modal, Field, Select, ConfirmButton, cx, nameOptions } from './ui';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const monthLabel = (m) => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; };
export const shiftMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const hours = (h) => `${String(h).replace('.', ',')} ч`;

// Полоса «использовано из лимита»
export function UsageBar({ usage, limit }) {
  const pct = limit ? Math.min(100, (usage.used_hours / limit) * 100) : 0;
  const over = usage.over_hours > 0;
  return (
    <div className="min-w-[180px]">
      <div className="flex justify-between text-[12px] mb-1 tabular">
        <span className={cx('font-medium', over ? 'text-red-600' : 'text-ink')}>{hours(usage.used_hours)}</span>
        <span className="text-ink-3">из {hours(limit)}</span>
      </div>
      <div className="h-2 rounded-full bg-line overflow-hidden">
        <div className={cx('h-full rounded-full transition-all duration-700', over ? 'bg-st-stuck' : pct > 80 ? 'bg-st-progress' : 'bg-st-done')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ContractsView() {
  const [month, setMonth] = useState(curMonth);
  const { data, reload } = useLoad(`/contracts?month=${month}`, [month]);
  const { isManager } = useApp();
  const [form, setForm] = useState(null);
  const [openId, setOpenId] = useState(null);
  if (!data) return <Spinner />;
  const totalOver = data.reduce((a, k) => a + k.usage.over_amount, 0);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="chip !px-2.5" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={16} /></button>
        <div className="min-w-36 text-center text-[15px] font-semibold capitalize">{monthLabel(month)}</div>
        <button className="chip !px-2.5" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={16} /></button>
        {totalOver > 0 && <span className="text-[13px] text-red-600 ml-2">Перерасход к оплате: <b>{fmtRub(totalOver)}</b></span>}
        {isManager && <Button className="ml-auto" variant="primary" icon={Plus} onClick={() => setForm({})}>Новый договор</Button>}
      </div>
      {!data.length ? <Card><Empty icon={FileClock} title="Абонентских договоров нет" text="Укажите для клиента лимит часов в месяц — CRM посчитает, сколько потрачено по задачам и заявкам, и покажет перерасход" /></Card> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-canvas/60 border-b border-line">
                <th className="th">Клиент</th><th className="th">Договор</th><th className="th">Часы за месяц</th><th className="th text-right">Абонплата</th><th className="th text-right">Перерасход</th>{isManager && <th className="th w-10" />}
              </tr></thead>
              <tbody>
                {data.map((k) => (
                  <tr key={k.id} onClick={() => setOpenId(k.id)} className={cx('border-b border-line last:border-0 hover:bg-canvas/50 cursor-pointer', !k.active && 'opacity-50')}>
                    <td className="td"><div className="text-ink font-medium">{k.client_name || k.project_name}</div>{k.client_name && k.project_name && <div className="text-[11.5px] text-ink-3">{k.project_name}</div>}</td>
                    <td className="td">{k.title || 'Абонентское обслуживание'}</td>
                    <td className="td"><UsageBar usage={k.usage} limit={k.hours_limit} /></td>
                    <td className="td text-right tabular">{k.monthly_fee ? fmtRub(k.monthly_fee) : '—'}</td>
                    <td className={cx('td text-right tabular', k.usage.over_hours > 0 && 'text-red-600 font-semibold')}>{k.usage.over_hours > 0 ? <>{hours(k.usage.over_hours)}{k.overage_rate > 0 && <div className="text-[11.5px]">{fmtRub(k.usage.over_amount)}</div>}</> : '—'}</td>
                    {isManager && <td className="td" onClick={(e) => e.stopPropagation()}><button onClick={() => setForm(k)} className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-2"><Pencil size={14} /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {form && <ContractModal k={form} onClose={() => setForm(null)} onSaved={reload} />}
      <ContractDrawer id={openId} month={month} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ContractModal({ k, onClose, onSaved }) {
  const { clients, projects, toast } = useApp();
  const [f, setF] = useState({ hours_limit: 20, active: 1, ...k });
  const set = (key) => (v) => setF((x) => ({ ...x, [key]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const save = async () => {
    if (!f.client_id && !f.project_id) return toast('Выберите клиента или проект', 'error');
    const body = { client_id: f.client_id ? +f.client_id : null, project_id: f.project_id ? +f.project_id : null, title: f.title || null, hours_limit: +f.hours_limit || 0,
      monthly_fee: +f.monthly_fee || 0, overage_rate: +f.overage_rate || 0, start_date: f.start_date || null, end_date: f.end_date || null, active: !!f.active, notes: f.notes || null };
    try { f.id ? await api.put(`/contracts/${f.id}`, body) : await api.post('/contracts', body); toast('Договор сохранён'); onSaved(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => { await api.del(`/contracts/${f.id}`); toast('Договор удалён'); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Абонентский договор' : 'Новый абонентский договор'} width={600}
      footer={<>{f.id && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="Проект" hint="Если работа по клиенту ведётся в проекте"><Select value={f.project_id} onChange={set('project_id')} placeholder="—" search options={nameOptions(projects)} /></Field>
        <Field label="Название" className="col-span-2"><input className="input" value={f.title || ''} onChange={set('title')} placeholder="Абонентское обслуживание, до 20 ПК" /></Field>
        <Field label="Часов в месяц"><input type="number" min="0" step="0.5" className="input" value={f.hours_limit} onChange={set('hours_limit')} /></Field>
        <Field label="Абонплата, ₽/мес"><input type="number" min="0" className="input" value={f.monthly_fee || ''} onChange={set('monthly_fee')} /></Field>
        <Field label="Сверх лимита, ₽/час" hint="Для расчёта доплаты"><input type="number" min="0" className="input" value={f.overage_rate || ''} onChange={set('overage_rate')} /></Field>
        <div />
        <Field label="Действует с"><input type="date" className="input" value={f.start_date || ''} onChange={set('start_date')} /></Field>
        <Field label="по"><input type="date" className="input" value={f.end_date || ''} onChange={set('end_date')} /></Field>
        <Field label="Заметки" className="col-span-2"><textarea className="input" rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={!!f.active} onChange={set('active')} className="accent-[var(--color-brand)] size-4" />Договор действует</label>
      </div>
    </Modal>
  );
}

function ContractDrawer({ id, month, onClose }) {
  const { toast } = useApp();
  const [k, setK] = useState(null);
  useEffect(() => { if (id) api.get(`/contracts/${id}?month=${month}`).then(setK).catch((e) => toast(e.message, 'error')); else setK(null); }, [id, month, toast]);
  if (!id) return null;
  const maxH = k ? Math.max(k.hours_limit, ...k.history.map((h) => h.used_hours), 1) : 1;
  return (
    <Drawer open onClose={onClose} width={720} title={k ? `${k.client_name || k.project_name} · ${k.title || 'абонентка'}` : 'Договор'}
      actions={k && <Button size="sm" icon={Printer} onClick={() => window.open(`/report/client?contract=${k.id}&month=${month}`, '_blank')}>Отчёт клиенту</Button>}>
      {!k ? <Spinner /> : (
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-canvas/60 p-4"><div className="text-[12px] text-ink-3">Потрачено, <span className="capitalize">{monthLabel(month)}</span></div><div className="text-[22px] font-bold tabular mt-1">{hours(k.usage.used_hours)}</div></div>
            <div className="rounded-2xl bg-canvas/60 p-4"><div className="text-[12px] text-ink-3">Лимит</div><div className="text-[22px] font-bold tabular mt-1">{hours(k.hours_limit)}</div></div>
            <div className={cx('rounded-2xl p-4', k.usage.over_hours > 0 ? 'bg-red-50' : 'bg-canvas/60')}><div className="text-[12px] text-ink-3">Перерасход</div><div className={cx('text-[22px] font-bold tabular mt-1', k.usage.over_hours > 0 && 'text-red-600')}>{k.usage.over_hours > 0 ? hours(k.usage.over_hours) : '—'}</div>{k.usage.over_amount > 0 && <div className="text-[12px] text-red-600">{fmtRub(k.usage.over_amount)}</div>}</div>
          </div>
          <div>
            <h3 className="text-[14px] font-semibold mb-3">За полгода</h3>
            <div className="flex items-end gap-3 h-36 relative">
              <div className="absolute left-0 right-0 border-t border-dashed border-st-stuck/60" style={{ bottom: `${(k.hours_limit / maxH) * 100}%` }} title="Лимит" />
              {k.history.map((h) => (
                <div key={h.month} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                  <span className="text-[11px] tabular text-ink-2">{h.used_hours ? String(h.used_hours).replace('.', ',') : ''}</span>
                  <div className={cx('w-full max-w-10 rounded-t-md', h.over_hours > 0 ? 'bg-st-stuck' : 'bg-st-done', h.month === month && 'ring-2 ring-ink/20')} style={{ height: `${(h.used_hours / maxH) * 100}%`, minHeight: h.used_hours ? 3 : 0 }} />
                  <span className="text-[11px] text-ink-3 capitalize">{monthLabel(h.month).slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-[14px] font-semibold mb-2">На что ушло время <span className="text-ink-3 font-normal">{k.entries.length}</span></h3>
            {!k.entries.length ? <div className="text-[13px] text-ink-3">В этом месяце записей нет</div> : (
              <div className="border border-line rounded-xl divide-y divide-line">
                {k.entries.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="text-ink-3 w-14 tabular">{fmtDate(e.started_at)}</span>
                    <div className="flex-1 min-w-0"><div className="truncate text-ink">{e.task_title || (e.ticket_id ? `#${e.ticket_id} ${e.ticket_title}` : e.description || e.project_name)}</div>
                      {e.description && (e.task_title || e.ticket_id) && <div className="text-[11.5px] text-ink-3 truncate">{e.description}</div>}</div>
                    <span className="text-ink-3 text-[12px]">{e.user_name?.split(' ')[0]}</span>
                    <span className="tabular font-medium w-14 text-right inline-flex items-center justify-end gap-1"><Clock size={12} className="text-ink-3" />{fmtHM(e.duration_sec)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {k.notes && <p className="text-[13px] text-ink-2 bg-canvas rounded-xl p-3 whitespace-pre-wrap">{k.notes}</p>}
        </div>
      )}
    </Drawer>
  );
}
