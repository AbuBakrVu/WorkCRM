import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, X, Building2, Phone, Mail, Pencil } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { CLIENT_TYPE, PROJECT_STATUS, DEAL_STAGE, TICKET_STATUS } from '../lib/constants';
import { fmtMoney, fmtMoneyShort, fmtDate } from '../lib/format';
import { Button, Card, Empty, Spinner, Drawer, Modal, Field, Select, StatusDot, ConfirmButton, PageHeader, cx } from '../components/ui';

export default function Clients() {
  const { data, loading } = useLoad('/clients');
  const { isManager } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // null | {} | client

  useEffect(() => {
    const o = params.get('open'); if (o) setOpenId(Number(o));
    if (params.get('new')) setForm({});
    if (o || params.get('new')) setParams({}, { replace: true });
  }, [params, setParams]);

  const list = useMemo(() => (data || []).filter((c) => (!type || c.type === type)
    && (!q || `${c.name} ${c.contact_name || ''} ${c.phone || ''} ${c.email || ''} ${c.inn || ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, type]);

  return (
    <div>
      <PageHeader title="Клиенты" subtitle="Организации и контакты: проекты, заявки, сделки и оплаты по каждому клиенту"
        actions={<Button variant="primary" icon={Plus} onClick={() => setForm({})}>Новый клиент</Button>} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-line bg-panel">
          <Search size={15} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, контакт, телефон, ИНН" className="outline-none text-[13px] w-60 bg-transparent" />
          {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
        </div>
        {[[null, 'Все'], ...Object.entries(CLIENT_TYPE)].map(([k, l]) => (
          <button key={l} className={cx('chip', type === k && 'chip-active')} onClick={() => setType(k)}>{l}</button>
        ))}
      </div>
      {loading && !data ? <Spinner /> : list.length === 0 ? (
        <Card><Empty icon={Building2} title="Клиентов нет" action={<Button variant="primary" icon={Plus} onClick={() => setForm({})}>Добавить клиента</Button>} /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-line bg-canvas/60">
              <th className="th min-w-[220px]">Клиент</th><th className="th">Контакт</th><th className="th">Телефон</th><th className="th text-right">Проекты</th>
              <th className="th text-right">Открытые заявки</th>{isManager && <th className="th text-right">Выручка</th>}
            </tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/50 cursor-pointer" onClick={() => setOpenId(c.id)}>
                  <td className="td">
                    <div className="flex items-center gap-2.5">
                      <span className="size-8 rounded-lg bg-canvas border border-line flex items-center justify-center text-[12px] font-semibold text-ink-2">{c.name.replace(/[«»"]/g, '').replace(/^(ООО|АО|ИП|ПАО)\s*/, '')[0]}</span>
                      <div><div className="text-ink font-[450]">{c.name}</div><div className="text-[11.5px] text-ink-3">{CLIENT_TYPE[c.type]}</div></div>
                    </div>
                  </td>
                  <td className="td">{c.contact_name || '—'}</td>
                  <td className="td tabular">{c.phone || '—'}</td>
                  <td className="td text-right tabular">{c.projects_count}</td>
                  <td className={cx('td text-right tabular', c.open_tickets > 0 && 'text-amber-600 font-medium')}>{c.open_tickets}</td>
                  {isManager && <td className="td text-right tabular">{c.revenue ? fmtMoneyShort(c.revenue) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ClientDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(c) => setForm(c)} />
      <ClientFormModal client={form} onClose={() => setForm(null)} onSaved={(c) => setOpenId(c.id)} />
    </div>
  );
}

function ClientFormModal({ client, onClose, onSaved }) {
  const { toast, bump } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (client) setF({ type: 'company', ...client }); }, [client]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.name?.trim()) return toast('Укажите название', 'error');
    const body = { name: f.name, type: f.type, contact_name: f.contact_name, phone: f.phone, email: f.email, inn: f.inn, address: f.address, notes: f.notes };
    try {
      const c = f.id ? await api.put(`/clients/${f.id}`, body) : await api.post('/clients', body);
      toast('Сохранено'); bump(); onSaved?.(c); onClose();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Modal open={!!client} onClose={onClose} title={f.id ? 'Редактировать клиента' : 'Новый клиент'} width={560}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Название" className="col-span-2"><input className="input" value={f.name || ''} onChange={set('name')} autoFocus /></Field>
        <Field label="Тип"><Select value={f.type} onChange={set('type')} options={Object.entries(CLIENT_TYPE).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="ИНН"><input className="input" value={f.inn || ''} onChange={set('inn')} /></Field>
        <Field label="Контактное лицо"><input className="input" value={f.contact_name || ''} onChange={set('contact_name')} /></Field>
        <Field label="Телефон"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Адрес"><input className="input" value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="Заметки" className="col-span-2"><textarea className="input" rows={3} value={f.notes || ''} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

function ClientDrawer({ id, onClose, onEdit }) {
  const { toast, bump, isManager, version } = useApp();
  const [c, setC] = useState(null);
  useEffect(() => { if (id) api.get(`/clients/${id}`).then(setC).catch((e) => toast(e.message, 'error')); else setC(null); }, [id, version, toast]);
  if (!id) return null;
  const remove = async () => { await api.del(`/clients/${id}`); toast('Клиент удалён'); bump(); onClose(); };
  return (
    <Drawer open={!!id} onClose={onClose} title={c?.name || 'Клиент'} width={620}
      actions={c && <Button size="sm" icon={Pencil} onClick={() => onEdit(c)}>Изменить</Button>}>
      {!c ? <Spinner /> : (
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
            <span>{CLIENT_TYPE[c.type]}</span>
            {c.contact_name && <span>{c.contact_name}</span>}
            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-violet"><Phone size={14} />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-violet"><Mail size={14} />{c.email}</a>}
            {c.inn && <span>ИНН {c.inn}</span>}
          </div>
          {c.address && <div className="text-[13px] text-ink-2">{c.address}</div>}
          {c.notes && <p className="text-[13px] text-ink-2 bg-canvas rounded-xl p-3 whitespace-pre-wrap">{c.notes}</p>}
          <Section title="Проекты" items={c.projects} render={(p) => <><span className="flex-1 truncate">{p.name}</span><StatusDot color={PROJECT_STATUS[p.status].color} label={PROJECT_STATUS[p.status].label} /></>} />
          <Section title="Сделки" items={c.deals} render={(d) => <><span className="flex-1 truncate">{d.title}</span><span className="tabular text-ink-2 mr-3">{fmtMoney(d.amount)}</span><StatusDot color={DEAL_STAGE[d.stage].color} label={DEAL_STAGE[d.stage].label} /></>} />
          <Section title="Заявки" items={c.tickets} render={(t) => <><span className="text-ink-3 tabular w-10">#{t.id}</span><span className="flex-1 truncate">{t.title}</span><StatusDot color={TICKET_STATUS[t.status].color} label={TICKET_STATUS[t.status].label} /></>} />
          {isManager && <Section title="Платежи" items={c.transactions} render={(x) => <><span className="text-ink-3 w-16">{fmtDate(x.date)}</span><span className="flex-1 truncate">{x.description}</span><span className={cx('tabular', x.type === 'income' ? 'text-emerald-600' : 'text-ink-2')}>{x.type === 'income' ? '+' : '−'}{fmtMoney(x.amount)}</span></>} />}
          {isManager && <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить клиента</ConfirmButton></div>}
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, items, render }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold mb-2">{title} <span className="text-ink-3 font-normal">{items.length}</span></h3>
      {items.length === 0 ? <div className="text-[13px] text-ink-3">Нет</div> : (
        <div className="border border-line rounded-xl divide-y divide-line">
          {items.map((i) => <div key={i.id} className="flex items-center gap-2 px-3 h-10 text-[13px]">{render(i)}</div>)}
        </div>
      )}
    </div>
  );
}
