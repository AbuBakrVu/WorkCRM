import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { CLIENT_TYPE } from '../lib/constants';
import { RequisitesFields, InnButton } from './Requisites';
import { Button, Modal, Field, Select } from './ui';

export function ClientFormModal({ client, onClose, onSaved }) {
  const { toast, bump } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (client) setF({ type: 'company', ...client }); }, [client]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const submit = async (e) => {
    e?.preventDefault(); e?.stopPropagation();
    if (!f.name?.trim()) return toast('Укажите название', 'error');
    const body = Object.fromEntries(['name', 'type', 'contact_name', 'phone', 'email', 'inn', 'address', 'notes', 'full_name', 'kpp', 'ogrn',
      'bank_name', 'bik', 'account', 'corr_account', 'director_name', 'director_title', 'edo_id'].map((k) => [k, f[k] ?? null]));
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
        <Field label="ИНН"><div className="flex gap-2"><input className="input" value={f.inn || ''} onChange={set('inn')} inputMode="numeric" maxLength={12} />
          {f.type !== 'person' && <InnButton inn={f.inn} fill={(d) => setF((x) => ({ ...x, ...Object.fromEntries(Object.entries(d).filter(([k, v]) => v != null && k !== 'status' && !(k === 'name' && x.name))) }))} />}</div></Field>
        <Field label="Контактное лицо"><input className="input" value={f.contact_name || ''} onChange={set('contact_name')} /></Field>
        <Field label="Телефон"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Адрес"><input className="input" value={f.address || ''} onChange={set('address')} /></Field>
        {f.type !== 'person' && <RequisitesFields f={f} set={set} withInn={false} open={!!(f.kpp || f.account || f.full_name)} title="Реквизиты для документов" />}
        <Field label="Заметки" className="col-span-2"><textarea className="input" rows={3} value={f.notes || ''} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

// Выбор клиента с кнопкой «+ Новый клиент» прямо в списке: форма открывается поверх, созданный клиент сразу выбирается
export function ClientSelect({ value, onChange, placeholder, ...rest }) {
  const { clients } = useApp();
  const [creating, setCreating] = useState(null);
  const [extra, setExtra] = useState(null);
  const list = extra && !clients.some((c) => c.id === extra.id) ? [...clients, extra] : clients;
  return (
    <>
      <Select value={value} onChange={onChange} placeholder={placeholder} search options={list.map((x) => ({ value: x.id, label: x.name }))}
        onCreate={(q) => setCreating({ type: 'company', name: q })} createLabel="Новый клиент" {...rest} />
      <ClientFormModal client={creating} onClose={() => setCreating(null)} onSaved={(c) => { setExtra(c); onChange(String(c.id), c); }} />
    </>
  );
}
