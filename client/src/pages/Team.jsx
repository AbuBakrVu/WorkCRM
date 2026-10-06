import { useEffect, useState } from 'react';
import { UserPlus, Mail, Phone } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { ROLES, USER_COLORS } from '../lib/constants';
import { fmtHours, fmtMoney } from '../lib/format';
import { Button, Card, Avatar, Modal, Field, Select, PageHeader, Pill, cx } from '../components/ui';

export default function Team() {
  const { users, user, isManager } = useApp();
  const [form, setForm] = useState(null);
  const isAdmin = user.role === 'admin';
  return (
    <div>
      <PageHeader title="Команда" subtitle="Сотрудники, роли и текущая загрузка"
        actions={isAdmin && <Button variant="primary" icon={UserPlus} onClick={() => setForm({})}>Добавить сотрудника</Button>} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {users.map((u) => (
          <Card key={u.id} className={cx('p-5', !u.active && 'opacity-60', isAdmin && 'cursor-pointer hover:shadow-md transition-shadow')} onClick={() => isAdmin && setForm(u)}>
            <div className="flex items-start gap-3">
              <Avatar user={u} size={44} ring={false} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><span className="font-semibold text-[14.5px] truncate">{u.name}</span>{!u.active && <Pill color="#6b7280" bg="#f1f2f4">отключён</Pill>}</div>
                <div className="text-[12.5px] text-ink-2 truncate">{u.position || '—'}</div>
                <div className="text-[11.5px] text-ink-3 mt-0.5">{ROLES[u.role]}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-[12.5px] text-ink-2">
              <div className="flex items-center gap-2 truncate"><Mail size={13} className="text-ink-3" />{u.email}</div>
              {u.phone && <div className="flex items-center gap-2"><Phone size={13} className="text-ink-3" />{u.phone}</div>}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-line text-center">
              <div><div className="text-[16px] font-semibold tabular">{u.open_tasks}</div><div className="text-[11px] text-ink-3">задач</div></div>
              <div><div className="text-[16px] font-semibold tabular">{u.open_tickets}</div><div className="text-[11px] text-ink-3">заявок</div></div>
              <div><div className="text-[16px] font-semibold tabular">{fmtHours(u.week_sec)}</div><div className="text-[11px] text-ink-3">за 7 дней</div></div>
            </div>
            {isManager && u.hourly_rate > 0 && <div className="text-[11.5px] text-ink-3 mt-3">Ставка {fmtMoney(u.hourly_rate)}/ч</div>}
          </Card>
        ))}
      </div>
      <UserModal u={form} onClose={() => setForm(null)} />
    </div>
  );
}

function UserModal({ u, onClose }) {
  const { toast, bump } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (u) setF({ role: 'member', active: 1, color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)], ...u, password: '' }); }, [u]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const submit = async (e) => {
    e?.preventDefault();
    const body = { name: f.name, email: f.email, role: f.role, position: f.position, phone: f.phone, color: f.color, hourly_rate: +f.hourly_rate || 0, active: +f.active };
    if (f.password) body.password = f.password;
    try { f.id ? await api.put(`/users/${f.id}`, body) : await api.post('/users', body); toast('Сохранено'); bump(); onClose(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Modal open={!!u} onClose={onClose} title={f.id ? 'Сотрудник' : 'Новый сотрудник'} width={540}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Имя и фамилия" className="col-span-2"><input className="input" value={f.name || ''} onChange={set('name')} autoFocus /></Field>
        <Field label="Email (логин)"><input type="email" className="input" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label={f.id ? 'Новый пароль' : 'Пароль'} hint={f.id ? 'Оставьте пустым, чтобы не менять' : 'Не короче 8 символов'}>
          <input type="password" className="input" value={f.password || ''} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Должность"><input className="input" value={f.position || ''} onChange={set('position')} /></Field>
        <Field label="Телефон"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Роль" hint="Менеджер видит финансы и может удалять записи"><Select value={f.role} onChange={set('role')} options={Object.entries(ROLES).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Ставка, ₽/ч"><input type="number" min="0" className="input" value={f.hourly_rate || ''} onChange={set('hourly_rate')} /></Field>
        <Field label="Цвет" className="col-span-2">
          <div className="flex gap-2">{USER_COLORS.map((c) => <button type="button" key={c} onClick={() => set('color')(c)} className={cx('size-7 rounded-full', f.color === c && 'ring-2 ring-offset-2 ring-ink')} style={{ background: c }} />)}</div>
        </Field>
        {f.id && <label className="col-span-2 flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-violet size-4" checked={!!+f.active} onChange={(e) => set('active')(e.target.checked ? 1 : 0)} />Активен (может входить в систему)</label>}
      </form>
    </Modal>
  );
}
