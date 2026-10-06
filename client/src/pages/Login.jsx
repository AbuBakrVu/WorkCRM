import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Button, Field } from '../components/ui';

export default function Login() {
  const { setUser } = useApp();
  const [setup, setSetup] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/auth/setup').then((r) => setSetup(r.needsSetup)).catch(() => {}); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { setUser(await api.post(setup ? '/auth/setup' : '/auth/login', form)); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top_left,#e3f4dd,transparent_55%),radial-gradient(ellipse_at_bottom_right,#e8e6fd,transparent_50%)]">
      <form onSubmit={submit} className="w-full max-w-[380px] bg-panel rounded-3xl border border-line shadow-xl p-7">
        <div className="size-11 rounded-full bg-brand flex items-center justify-center text-brand-ink mb-5">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="9.5" y="2.5" width="5" height="5" rx="1.3" transform="rotate(45 12 5)"/><rect x="9.5" y="16.5" width="5" height="5" rx="1.3" transform="rotate(45 12 19)"/><rect x="2.5" y="9.5" width="5" height="5" rx="1.3" transform="rotate(45 5 12)"/><rect x="16.5" y="9.5" width="5" height="5" rx="1.3" transform="rotate(45 19 12)"/></svg>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">{setup ? 'Первый запуск' : 'Вход в CRM'}</h1>
        <p className="text-ink-2 text-[13.5px] mt-1 mb-6">{setup ? 'Создайте учётную запись администратора' : 'Проекты, заявки, клиенты и финансы — в одном месте'}</p>
        <div className="space-y-3.5">
          {setup && <Field label="Имя"><input className="input h-10" value={form.name} onChange={set('name')} required autoFocus /></Field>}
          <Field label="Email"><input className="input h-10" type="email" value={form.email} onChange={set('email')} required autoFocus={!setup} autoComplete="username" /></Field>
          <Field label="Пароль" hint={setup ? 'Не короче 8 символов' : undefined}>
            <input className="input h-10" type="password" value={form.password} onChange={set('password')} required autoComplete={setup ? 'new-password' : 'current-password'} />
          </Field>
        </div>
        {err && <div className="mt-4 text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
        <Button variant="primary" size="lg" className="w-full mt-6" disabled={busy}>{busy ? 'Подождите…' : setup ? 'Создать и войти' : 'Войти'}</Button>
      </form>
    </div>
  );
}
