import { useEffect, useRef, useState } from 'react';
import { UserCheck, Building2, UserPlus, Mail, Lock, User } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Button } from '../components/ui';
import { MountainsArt, SunsetArt } from '../components/LoginArt';
import './login.css';

const Logo = () => (
  <span className="size-11 rounded-full bg-brand flex items-center justify-center text-brand-ink">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="9.5" y="2.5" width="5" height="5" rx="1.3" transform="rotate(45 12 5)"/><rect x="9.5" y="16.5" width="5" height="5" rx="1.3" transform="rotate(45 12 19)"/><rect x="2.5" y="9.5" width="5" height="5" rx="1.3" transform="rotate(45 5 12)"/><rect x="16.5" y="9.5" width="5" height="5" rx="1.3" transform="rotate(45 19 12)"/></svg>
  </span>
);

function Input({ label, icon: Icon, hint, ...p }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-[12px] font-medium text-ink-2 mb-1.5">{label}</span>
      <span className="auth-input block">
        <input className="input" required {...p} />
        <Icon size={16} strokeWidth={2} />
      </span>
      {hint && <span className="block text-[11.5px] text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

const Err = ({ text }) => text ? <div className="mb-3 text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{text}</div> : null;

export default function Login() {
  const { setUser } = useApp();
  const cardRef = useRef(null);
  const [setup, setSetup] = useState(false); // пустая база → вторая вкладка = «Первый запуск»
  const [view, setView] = useState('signin'); // signin | second
  const [team, setTeam] = useState({ email: '', password: '' });
  const [second, setSecond] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/auth/setup').then((r) => { setSetup(r.needsSetup); if (r.needsSetup) setView('second'); }).catch(() => {}); }, []);

  // Во время ресайза отключаем анимации (иначе панели «ездят» при смене раскладки)
  useEffect(() => {
    let t;
    const onResize = () => {
      cardRef.current?.classList.add('resizing');
      clearTimeout(t);
      t = setTimeout(() => cardRef.current?.classList.remove('resizing'), 150);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, []);

  const bind = (state, setState) => (k) => ({ value: state[k], onChange: (e) => setState((f) => ({ ...f, [k]: e.target.value })) });
  const t = bind(team, setTeam);
  const s = bind(second, setSecond);

  const submit = (which, url, body) => async (e) => {
    e.preventDefault();
    setErr({}); setBusy(true);
    try { setUser(await api.post(url, body)); }
    catch (x) { setErr({ [which]: x.message }); }
    finally { setBusy(false); }
  };

  const isFirst = view === 'signin';
  const vars = isFirst
    ? { '--active': '33.33%', '--hero': '0', '--forms': '0' }
    : { '--active': '66.66%', '--hero': '-100%', '--forms': '-100%' };

  const tab2 = setup
    ? { label: 'Первый запуск', icon: UserPlus, title: 'Первый запуск.', sub: 'Создайте учётную запись администратора.' }
    : { label: 'Клиентам', icon: Building2, title: 'Кабинет клиента.', sub: 'Заявки, отчёты и документы вашей организации.' };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12 bg-[radial-gradient(ellipse_at_top_left,#e3f4dd,transparent_55%),radial-gradient(ellipse_at_bottom_right,#dcefe4,transparent_50%)] dark:bg-none">
      <div ref={cardRef} className="auth-card" style={vars}>
        <ul className="auth-nav">
          <li><Logo /></li>
          <li>
            <button type="button" className={isFirst ? 'active' : ''} onClick={() => setView('signin')} aria-pressed={isFirst}>
              <UserCheck size={22} strokeWidth={1.8} /><span>Вход</span>
            </button>
          </li>
          <li>
            <button type="button" className={!isFirst ? 'active' : ''} onClick={() => setView('second')} aria-pressed={!isFirst}>
              <tab2.icon size={22} strokeWidth={1.8} /><span>{tab2.label}</span>
            </button>
          </li>
          <li className="auth-bar" aria-hidden="true" />
        </ul>

        <div className="auth-hero">
          <div className="auth-hero-inner">
            <div className="auth-hero-content">
              <div><h2>С&nbsp;возвращением.</h2><h3>Введите данные для входа.</h3></div>
              <MountainsArt />
            </div>
            <div className="auth-hero-content">
              <div><h2>{tab2.title}</h2><h3>{tab2.sub}</h3></div>
              <SunsetArt />
            </div>
          </div>
        </div>

        <div className="auth-form">
          <div className="auth-forms">
            <form onSubmit={submit('team', '/auth/login', team)} inert={!isFirst}>
              <p className="auth-switch">
                {setup ? <>Система ещё не настроена? <button type="button" onClick={() => setView('second')}>Первый запуск</button></>
                  : <>Вы клиент компании? <button type="button" onClick={() => setView('second')}>Кабинет клиента</button></>}
              </p>
              <Input label="Email" icon={Mail} type="email" placeholder="you@company.ru" autoComplete="username" autoFocus={!setup} {...t('email')} />
              <Input label="Пароль" icon={Lock} type="password" placeholder="••••••••" autoComplete="current-password" {...t('password')} />
              <Err text={err.team} />
              <Button variant="primary" size="lg" className="w-full mt-1 h-11" disabled={busy}>{busy && isFirst ? 'Подождите…' : 'Войти'}</Button>
              <p className="auth-note">Нет доступа или забыли пароль? Обратитесь к администратору CRM.</p>
            </form>

            {setup ? (
              <form onSubmit={submit('second', '/auth/setup', second)} inert={isFirst}>
                <p className="auth-switch">Уже есть учётная запись? <button type="button" onClick={() => setView('signin')}>Войти</button></p>
                <Input label="Имя" icon={User} placeholder="Иван Иванов" autoComplete="name" {...s('name')} />
                <Input label="Email" icon={Mail} type="email" placeholder="admin@company.ru" autoComplete="username" {...s('email')} />
                <Input label="Пароль" icon={Lock} type="password" placeholder="Не короче 8 символов" minLength={8} autoComplete="new-password" {...s('password')} />
                <Err text={err.second} />
                <Button variant="primary" size="lg" className="w-full mt-1 h-11" disabled={busy}>{busy && !isFirst ? 'Подождите…' : 'Создать и войти'}</Button>
              </form>
            ) : (
              <form onSubmit={submit('second', '/auth/login', { email: second.email, password: second.password })} inert={isFirst}>
                <p className="auth-switch">Сотрудник компании? <button type="button" onClick={() => setView('signin')}>Вход для команды</button></p>
                <Input label="Email" icon={Mail} type="email" placeholder="you@client.ru" autoComplete="username" {...s('email')} />
                <Input label="Пароль" icon={Lock} type="password" placeholder="••••••••" autoComplete="current-password" {...s('password')} />
                <Err text={err.second} />
                <Button variant="primary" size="lg" className="w-full mt-1 h-11" disabled={busy}>{busy && !isFirst ? 'Подождите…' : 'Войти в кабинет'}</Button>
                <p className="auth-note">Доступ в кабинет выдаёт ваш менеджер. Здесь вы видите заявки, отчёты о работах и документы.</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
