import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Search, X, Monitor, Laptop, Printer, Network, Router, Server, BatteryCharging, Cctv, Phone, Package, Pencil, BookOpen } from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { api } from '../lib/api';
import { TICKET_STATUS } from '../lib/constants';
import { fmtDate, todayStr } from '../lib/format';
import { Button, Card, Empty, Spinner, Drawer, Modal, Field, Select, ConfirmButton, PageHeader, StatusDot, cx, nameOptions } from '../components/ui';
import { HistoryPanel } from '../components/History';

export const ASSET_TYPES = {
  pc: ['Компьютер', Monitor], laptop: ['Ноутбук', Laptop], printer: ['Принтер / МФУ', Printer], switch: ['Коммутатор', Network], router: ['Роутер / точка доступа', Router],
  server: ['Сервер / NAS', Server], ups: ['ИБП', BatteryCharging], camera: ['Камера / регистратор', Cctv], phone: ['Телефония', Phone], other: ['Другое', Package],
};
export const ASSET_STATUS = {
  active: { label: 'Работает', color: 'var(--color-st-done)' }, repair: { label: 'В ремонте', color: 'var(--color-st-progress)' },
  storage: { label: 'На складе', color: 'var(--color-st-review)' }, written_off: { label: 'Списано', color: 'var(--color-st-planned)' },
};

export default function Assets() {
  const { data, reload } = useLoad('/assets');
  const { clients } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [client, setClient] = useStored('crm.assets.client', null);
  const [type, setType] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null);
  useEffect(() => { const o = Number(params.get('open')); if (o) { setOpenId(o); setParams({}, { replace: true }); } }, [params, setParams]);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data || []).filter((a) => (!client || a.client_id === +client) && (!type || a.type === type)
      && (!ql || `${a.name} ${a.model || ''} ${a.serial || ''} ${a.inventory_no || ''} ${a.ip || ''} ${a.mac || ''} ${a.location || ''} ${a.owner || ''}`.toLowerCase().includes(ql)));
  }, [data, q, client, type]);
  if (!data) return <Spinner />;
  const today = todayStr();
  return (
    <div>
      <PageHeader title="Оборудование" subtitle="Техника клиентов: где стоит, IP-адреса, гарантия и история заявок"
        actions={<Button variant="primary" icon={Plus} onClick={() => setForm({ client_id: client })}>Добавить</Button>} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className={cx('flex items-center gap-1.5 h-9 px-3 rounded-full border bg-panel', q ? 'border-violet/40' : 'border-line')}>
          <Search size={15} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, модель, S/N, IP, MAC, кабинет" className="outline-none text-[13px] w-64 bg-transparent" />
          {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
        </div>
        <div className="w-60"><Select value={client} onChange={setClient} placeholder="Все клиенты" search options={nameOptions(clients)} /></div>
        <div className="w-52"><Select value={type} onChange={setType} placeholder="Все типы" options={Object.entries(ASSET_TYPES).map(([value, [label]]) => ({ value, label }))} /></div>
      </div>
      {!list.length ? <Card><Empty icon={Monitor} title={data.length ? 'Ничего не найдено' : 'Оборудование не добавлено'} text="Добавьте технику клиента — компьютеры, принтеры, коммутаторы, ИБП. К заявкам можно будет привязать конкретное устройство." /></Card> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-canvas/60 border-b border-line">
                <th className="th">Устройство</th><th className="th">Клиент</th><th className="th">Где</th><th className="th">IP / MAC</th><th className="th">S/N, инв. №</th><th className="th">Гарантия</th><th className="th">Заявки</th><th className="th">Статус</th>
              </tr></thead>
              <tbody>
                {list.map((a) => { const [label, Icon] = ASSET_TYPES[a.type] || ASSET_TYPES.other; const wOut = a.warranty_until && a.warranty_until < today; return (
                  <tr key={a.id} onClick={() => setOpenId(a.id)} className="border-b border-line last:border-0 hover:bg-canvas/50 cursor-pointer">
                    <td className="td"><span className="flex items-center gap-2.5"><span className="size-8 rounded-lg bg-canvas border border-line grid place-items-center text-ink-2"><Icon size={15} /></span>
                      <span><span className="block text-ink font-medium">{a.name}</span><span className="block text-[11.5px] text-ink-3">{a.model || label}</span></span></span></td>
                    <td className="td">{a.client_name || a.project_name || '—'}</td>
                    <td className="td">{a.location || '—'}{a.owner && <div className="text-[11.5px] text-ink-3">{a.owner}</div>}</td>
                    <td className="td tabular">{a.ip || '—'}{a.mac && <div className="text-[11px] text-ink-3">{a.mac}</div>}</td>
                    <td className="td tabular">{a.serial || '—'}{a.inventory_no && <div className="text-[11px] text-ink-3">инв. {a.inventory_no}</div>}</td>
                    <td className={cx('td', wOut && 'text-ink-3')}>{a.warranty_until ? <>{wOut ? 'истекла ' : 'до '}{fmtDate(a.warranty_until, true)}</> : '—'}</td>
                    <td className="td">{a.tickets_count ? <span className={cx(a.open_tickets > 0 && 'text-amber-600 font-medium')}>{a.tickets_count}{a.open_tickets > 0 && ` (${a.open_tickets} откр.)`}</span> : '—'}</td>
                    <td className="td"><StatusDot color={ASSET_STATUS[a.status]?.color} label={ASSET_STATUS[a.status]?.label} /></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <AssetDrawer id={openId} onClose={() => setOpenId(null)} onEdit={setForm} />
      {form && <AssetModal asset={form} onClose={() => setForm(null)} onSaved={(a) => { reload(); if (!form.id) setOpenId(a.id); }} />}
    </div>
  );
}

function AssetDrawer({ id, onClose, onEdit }) {
  const { toast, version, isManager, bump } = useApp();
  const [a, setA] = useState(null);
  useEffect(() => { if (id) api.get(`/assets/${id}`).then(setA).catch((e) => toast(e.message, 'error')); else setA(null); }, [id, version, toast]);
  if (!id) return null;
  const [label, Icon] = a ? (ASSET_TYPES[a.type] || ASSET_TYPES.other) : [];
  const remove = async () => { await api.del(`/assets/${id}`); toast('Устройство удалено в корзину'); bump(); onClose(); };
  return (
    <Drawer open onClose={onClose} width={680} title={a?.name || 'Устройство'} actions={a && <Button size="sm" icon={Pencil} onClick={() => onEdit(a)}>Изменить</Button>}>
      {!a ? <Spinner /> : (
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <span className="size-12 rounded-2xl bg-brand/10 text-brand grid place-items-center"><Icon size={22} /></span>
            <div><div className="text-[13px] text-ink-3">{label}{a.client_name && ` · ${a.client_name}`}</div><StatusDot color={ASSET_STATUS[a.status]?.color} label={ASSET_STATUS[a.status]?.label} /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] bg-canvas/60 rounded-2xl p-4">
            {[['Модель', a.model], ['Серийный номер', a.serial], ['Инвентарный №', a.inventory_no], ['IP-адрес', a.ip], ['MAC-адрес', a.mac], ['Где стоит', a.location],
              ['Пользователь', a.owner], ['Проект', a.project_name], ['Куплено', a.purchase_date && fmtDate(a.purchase_date, true)], ['Гарантия до', a.warranty_until && fmtDate(a.warranty_until, true)]].map(([k, v]) => (
              <div key={k} className="min-w-0"><div className="text-[11.5px] text-ink-3">{k}</div><div className="text-ink break-words tabular">{v || '—'}</div></div>
            ))}
          </div>
          {a.notes && <p className="text-[13px] text-ink-2 bg-canvas rounded-xl p-3 whitespace-pre-wrap">{a.notes}</p>}
          <div>
            <div className="flex items-center justify-between mb-2"><h3 className="text-[14px] font-semibold">Заявки по устройству <span className="text-ink-3 font-normal">{a.tickets.length}</span></h3>
              <Link to={`/tickets?new=1&asset=${a.id}&client=${a.client_id || ''}`} className="text-[12.5px] text-violet font-medium hover:underline">+ Новая заявка</Link></div>
            {!a.tickets.length ? <div className="text-[13px] text-ink-3">Заявок не было</div> : (
              <div className="border border-line rounded-xl divide-y divide-line">
                {a.tickets.map((t) => (
                  <Link key={t.id} to={`/tickets?open=${t.id}`} className="block px-3 py-2 text-[13px] hover:bg-canvas">
                    <div className="flex items-center gap-2"><span className="text-ink-3 tabular w-10">#{t.id}</span><span className="flex-1 truncate text-ink">{t.title}</span><StatusDot color={TICKET_STATUS[t.status].color} label={TICKET_STATUS[t.status].label} /></div>
                    {t.resolution && <div className="text-[12px] text-ink-3 ml-12 line-clamp-2">{t.resolution}</div>}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {a.articles.length > 0 && <div><h3 className="text-[14px] font-semibold mb-2">В базе знаний</h3>
            {a.articles.map((k) => <Link key={k.id} to={`/kb?open=${k.id}`} className="flex items-center gap-2 text-[13px] py-1 hover:text-violet"><BookOpen size={14} className="text-ink-3" />{k.title}</Link>)}</div>}
          <HistoryPanel entity="asset" id={a.id} />
          {isManager && <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить устройство</ConfirmButton></div>}
        </div>
      )}
    </Drawer>
  );
}

function AssetModal({ asset, onClose, onSaved }) {
  const { clients, projects, toast, bump } = useApp();
  const [f, setF] = useState({ type: 'pc', status: 'active', ...asset });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    if (!f.name?.trim()) return toast('Укажите название', 'error');
    const body = Object.fromEntries(['type', 'name', 'model', 'serial', 'inventory_no', 'ip', 'mac', 'location', 'owner', 'purchase_date', 'warranty_until', 'status', 'notes'].map((k) => [k, f[k] || null]));
    Object.assign(body, { client_id: f.client_id ? +f.client_id : null, project_id: f.project_id ? +f.project_id : null });
    try { const a = f.id ? await api.put(`/assets/${f.id}`, body) : await api.post('/assets', body); toast('Сохранено'); bump(); onSaved(a); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  const inp = (k, p = {}) => <input className="input" value={f[k] || ''} onChange={set(k)} {...p} />;
  return (
    <Modal open onClose={onClose} title={f.id ? 'Устройство' : 'Новое устройство'} width={640}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Тип"><Select value={f.type} onChange={set('type')} options={Object.entries(ASSET_TYPES).map(([value, [label]]) => ({ value, label }))} /></Field>
        <Field label="Статус"><Select value={f.status} onChange={set('status')} options={Object.entries(ASSET_STATUS).map(([value, s]) => ({ value, label: s.label, color: s.color }))} /></Field>
        <Field label="Название" className="col-span-2" hint="Как его называют у клиента: «ПК бухгалтера», «Коммутатор 2 этаж»">{inp('name', { autoFocus: true })}</Field>
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="Проект"><Select value={f.project_id} onChange={set('project_id')} placeholder="—" search options={nameOptions(projects)} /></Field>
        <Field label="Модель">{inp('model')}</Field>
        <Field label="Серийный номер">{inp('serial')}</Field>
        <Field label="IP-адрес">{inp('ip', { placeholder: '192.168.1.10' })}</Field>
        <Field label="MAC-адрес">{inp('mac')}</Field>
        <Field label="Где стоит">{inp('location', { placeholder: 'Корпус 2, каб. 214' })}</Field>
        <Field label="Пользователь">{inp('owner', { placeholder: 'ФИО сотрудника' })}</Field>
        <Field label="Инвентарный №">{inp('inventory_no')}</Field>
        <div />
        <Field label="Дата покупки"><input type="date" className="input" value={f.purchase_date || ''} onChange={set('purchase_date')} /></Field>
        <Field label="Гарантия до"><input type="date" className="input" value={f.warranty_until || ''} onChange={set('warranty_until')} /></Field>
        <Field label="Заметки" className="col-span-2" hint="Пароли и доступы храните в «Базе знаний» — там они зашифрованы"><textarea className="input" rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}
