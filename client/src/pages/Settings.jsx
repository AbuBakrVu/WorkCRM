import { useState } from 'react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { ROLES, USER_COLORS } from '../lib/constants';
import { Button, Card, Field, PageHeader, Avatar, cx } from '../components/ui';

export default function Settings() {
  const { user, setUser, toast, bump } = useApp();
  const [f, setF] = useState({ name: user.name, position: user.position || '', phone: user.phone || '', color: user.color });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const save = async (e) => {
    e.preventDefault();
    try { setUser(await api.put('/auth/me', f)); bump(); toast('Профиль сохранён'); } catch (err) { toast(err.message, 'error'); }
  };
  const savePw = async (e) => {
    e.preventDefault();
    try { await api.put('/auth/me', pw); setPw({ current_password: '', new_password: '' }); toast('Пароль изменён'); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="max-w-[720px]">
      <PageHeader title="Настройки" subtitle="Профиль и безопасность" />
      <Card className="p-6">
        <div className="flex items-center gap-4 mb-5">
          <Avatar user={{ ...user, ...f }} size={56} ring={false} />
          <div><div className="font-semibold">{user.email}</div><div className="text-[12.5px] text-ink-3">{ROLES[user.role]}</div></div>
        </div>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-3.5">
          <Field label="Имя"><input className="input" value={f.name} onChange={set('name')} /></Field>
          <Field label="Должность"><input className="input" value={f.position} onChange={set('position')} /></Field>
          <Field label="Телефон"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Цвет аватара">
            <div className="flex flex-wrap gap-2 pt-1">{USER_COLORS.map((c) => <button type="button" key={c} onClick={() => set('color')(c)} className={cx('size-7 rounded-full', f.color === c && 'ring-2 ring-offset-2 ring-ink')} style={{ background: c }} />)}</div>
          </Field>
          <div className="sm:col-span-2"><Button variant="primary">Сохранить</Button></div>
        </form>
      </Card>
      <Card className="p-6 mt-4">
        <h2 className="text-[15px] font-semibold mb-4">Смена пароля</h2>
        <form onSubmit={savePw} className="grid sm:grid-cols-2 gap-3.5">
          <Field label="Текущий пароль"><input type="password" className="input" value={pw.current_password} onChange={(e) => setPw((x) => ({ ...x, current_password: e.target.value }))} autoComplete="current-password" /></Field>
          <Field label="Новый пароль" hint="Не короче 8 символов"><input type="password" className="input" value={pw.new_password} onChange={(e) => setPw((x) => ({ ...x, new_password: e.target.value }))} autoComplete="new-password" /></Field>
          <div className="sm:col-span-2"><Button variant="dark" disabled={!pw.new_password}>Изменить пароль</Button></div>
        </form>
      </Card>
    </div>
  );
}
