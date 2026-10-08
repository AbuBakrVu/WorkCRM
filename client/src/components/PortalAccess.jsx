import { useEffect, useState } from 'react';
import { KeyRound, Plus, Copy, RotateCcw, Power, Trash2 } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, ConfirmButton, cx } from './ui';

// Доступ сотрудников клиента в личный кабинет (заявки, счета, отчёты)
export function PortalAccess({ clientId }) {
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);
  const [shown, setShown] = useState(null); // { email, password } — показываем один раз
  const load = () => api.get(`/clients/${clientId}/portal-users`).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    try { const u = await api.post(`/clients/${clientId}/portal-users`, form); setShown({ email: u.email, password: u.password }); setForm(null); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const act = async (u, body) => {
    try { const r = await api.put(`/portal-users/${u.id}`, body); if (r.password) setShown({ email: r.email, password: r.password }); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const del = async (u) => { await api.del(`/portal-users/${u.id}`); load(); };
  const copy = () => { navigator.clipboard?.writeText(`Личный кабинет: ${location.origin}\nЛогин: ${shown.email}\nПароль: ${shown.password}`); toast('Скопировано — отправьте клиенту'); };
  if (!list) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[14px] font-semibold">Личный кабинет <span className="text-ink-3 font-normal">{list.length}</span></h3>
        {!form && <button onClick={() => setForm({ name: '', email: '' })} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline"><Plus size={13} />Открыть доступ</button>}
      </div>
      <p className="text-[12px] text-ink-3 mb-2">Сотрудники клиента сами создают заявки, переписываются по ним, видят счета, оборудование и отчёты о выполненных работах.</p>
      {shown && (
        <div className="rounded-xl border border-brand/40 bg-brand/[.05] p-3 mb-2 text-[13px]">
          <div className="font-semibold mb-1 flex items-center gap-1.5"><KeyRound size={14} className="text-brand" />Пароль показывается один раз</div>
          <div className="font-mono text-[12.5px]">{shown.email} / {shown.password}</div>
          <div className="flex gap-2 mt-2"><Button size="sm" icon={Copy} onClick={copy}>Скопировать для отправки</Button><Button size="sm" variant="ghost" onClick={() => setShown(null)}>Готово</Button></div>
        </div>
      )}
      {form && (
        <div className="rounded-xl border border-line p-3 mb-2 grid grid-cols-2 gap-2">
          <input autoFocus className="input" placeholder="Имя" value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} />
          <input className="input" placeholder="Email (логин)" value={form.email} onChange={(e) => setForm((x) => ({ ...x, email: e.target.value }))} />
          <div className="col-span-2 flex justify-end gap-2"><Button size="sm" onClick={() => setForm(null)}>Отмена</Button><Button size="sm" variant="primary" onClick={add}>Создать доступ</Button></div>
        </div>
      )}
      {list.length > 0 && (
        <div className="border border-line rounded-xl divide-y divide-line">
          {list.map((u) => (
            <div key={u.id} className={cx('flex items-center gap-2 px-3 h-11 text-[13px]', !u.active && 'opacity-50')}>
              <span className="flex-1 min-w-0 truncate"><b className="font-medium text-ink">{u.name}</b> <span className="text-ink-3">{u.email}</span></span>
              <span className="text-[11.5px] text-ink-3 hidden sm:block">{u.last_login_at ? `вход ${fmtDateTime(u.last_login_at)}` : 'ещё не входил'}</span>
              <button onClick={() => act(u, { reset_password: true })} title="Новый пароль" className="size-7 grid place-items-center rounded-full hover:bg-canvas text-ink-2"><RotateCcw size={13} /></button>
              <button onClick={() => act(u, { active: !u.active })} title={u.active ? 'Отключить' : 'Включить'} className="size-7 grid place-items-center rounded-full hover:bg-canvas text-ink-2"><Power size={13} /></button>
              <ConfirmButton size="sm" variant="ghost" onConfirm={() => del(u)}><Trash2 size={13} /></ConfirmButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
