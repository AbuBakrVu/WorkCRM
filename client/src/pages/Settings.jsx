import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { ROLES, USER_COLORS } from '../lib/constants';
import { Button, Card, Field, PageHeader, Avatar, Tabs, cx } from '../components/ui';
import { useStored } from '../lib/store';
import { CompaniesSettings } from '../components/Companies';

export default function Settings() {
  const { user, setUser, toast, bump, isManager } = useApp();
  const [tab, setTab] = useStored('crm.settings.tab', 'profile');
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
    <div className="max-w-[820px]">
      <PageHeader title="Настройки" subtitle="Профиль, безопасность и реквизиты компаний" />
      {isManager && (
        <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Профиль' }, { value: 'companies', label: 'Мои компании' },
          ...(user.role === 'admin' ? [{ value: 'integrations', label: 'Интеграции' }] : [])]} /></div>
      )}
      {isManager && tab === 'companies' ? <CompaniesSettings /> : user.role === 'admin' && tab === 'integrations' ? <Integrations /> : (<>
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
      </>)}
    </div>
  );
}

function Integrations() {
  const { toast } = useApp();
  const [f, setF] = useState(null);
  useEffect(() => { api.get('/app-settings').then(setF).catch((e) => toast(e.message, 'error')); }, [toast]);
  if (!f) return null;
  const save = async () => { try { await api.put('/app-settings', f); toast('Сохранено'); setF(await api.get('/app-settings')); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Card className="p-6">
      <h2 className="text-[15px] font-semibold">DaData — реквизиты по ИНН</h2>
      <p className="text-[13px] text-ink-2 mt-1 mb-4">Вводите ИНН — название, КПП, ОГРН, адрес и руководитель заполнятся сами; по БИК подставляются банк и корр. счёт.
        Ключ бесплатный: зарегистрируйтесь на <a href="https://dadata.ru" target="_blank" rel="noreferrer" className="text-violet hover:underline">dadata.ru</a> → Личный кабинет → «API-ключ» (10 000 запросов в день бесплатно).</p>
      <div className="flex gap-2 max-w-[520px]">
        <input className="input" value={f.dadata_key || ''} onChange={(e) => setF((x) => ({ ...x, dadata_key: e.target.value }))} placeholder="API-ключ" autoComplete="off" />
        <Button variant="primary" onClick={save}>Сохранить</Button>
      </div>
    </Card>
  );
}
