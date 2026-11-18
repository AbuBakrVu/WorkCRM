import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { ROLES, USER_COLORS } from '../lib/constants';
import { UserRound, Users, Building, FileText, Package, Plug, Trash2, ListTodo } from 'lucide-react';
import { Button, Card, Field, PageHeader, Avatar, cx } from '../components/ui';
import Hub from '../components/Hub';
import Team from './Team';
import Catalog from './Catalog';
import { CompaniesSettings } from '../components/Companies';
import { TaskTemplatesSettings } from '../components/TaskTemplates';
import { TemplatesSettings } from '../components/Documents';
import { TrashSettings, shortUA } from '../components/Trash';
import { fmtDateTime } from '../lib/format';
import { useLoad } from '../lib/store';
import { ProjectSelect } from '../components/ProjectForm';

export default function Settings() {
  const { user, isManager } = useApp();
  const isAdmin = user.role === 'admin';
  const pane = (subtitle, el, wide) => <div className={wide ? '' : 'max-w-[900px]'}><PageHeader title="Настройки" subtitle={subtitle} />{el}</div>;
  return (
    <Hub title="Настройки" base="/settings" tabs={[
      { value: 'profile', label: 'Профиль', icon: UserRound, element: <Profile /> },
      { value: 'team', label: 'Команда', icon: Users, element: <Team /> },
      { value: 'companies', label: 'Мои компании', icon: Building, hidden: !isManager, element: pane('Реквизиты, подпись и печать — для счетов, актов и КП', <CompaniesSettings />) },
      { value: 'templates', label: 'Шаблоны документов', icon: FileText, hidden: !isManager, element: pane('Word-шаблоны КП, счетов и актов', <TemplatesSettings />) },
      { value: 'tasktpl', label: 'Шаблоны задач', icon: ListTodo, element: pane('Типовые задачи с чек-листом и подзадачами', <TaskTemplatesSettings />) },
      { value: 'catalog', label: 'Каталог', icon: Package, element: <Catalog /> },
      { value: 'integrations', label: 'Интеграции', icon: Plug, hidden: !isAdmin, element: pane('Внешние сервисы', <Integrations />) },
      { value: 'trash', label: 'Корзина', icon: Trash2, hidden: !isManager, element: pane('Удалённые записи можно восстановить', <TrashSettings />) },
    ]} />
  );
}

function Profile() {
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
    <div className="max-w-[900px]">
      <PageHeader title="Настройки" subtitle="Ваш профиль, пароль и последние входы" />
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
      <MyTelegram />
      <MyLogins />
    </div>
  );
}

function Integrations() {
  return <div className="space-y-4"><Messengers /><DaData /></div>;
}

const ChannelState = ({ s, okText }) => (
  <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', s?.connected ? 'text-emerald-600' : s?.error ? 'text-red-600' : 'text-ink-3')}>
    <span className={cx('size-2 rounded-full', s?.connected ? 'bg-emerald-500' : s?.error ? 'bg-red-500' : 'bg-line')} />
    {s?.connected ? okText : s?.error ? s.error : 'не подключено'}
  </span>
);

function Messengers() {
  const { toast } = useApp();
  const [d, setD] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const load = () => api.get('/messengers').then((r) => { setD(r); setF(r.settings); }).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    try { await api.put('/messengers', f); toast('Сохранено'); await load(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const check = async () => { try { const r = await api.post('/messengers/check'); setD((x) => ({ ...x, state: r.state })); } catch (e) { toast(e.message, 'error'); } };
  const test = async () => { try { await api.post('/messengers/whatsapp/test', { phone: testPhone }); toast('Сообщение отправлено'); } catch (e) { toast(e.message, 'error'); } };
  const st = d.state;
  return (
    <>
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold">Telegram-бот</h2>
          <ChannelState s={st.telegram} okText={`работает${st.telegram.bot ? ` · @${st.telegram.bot}` : ''}`} />
        </div>
        <p className="text-[13px] text-ink-2 mt-1 mb-4">Клиенты пишут боту — создаётся заявка, ответы из карточки заявки приходят им от бота. Через этого же бота сотрудники получают уведомления (подключают в своём профиле).
          Создайте бота у <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-violet hover:underline">@BotFather</a> командой <code>/newbot</code> и вставьте выданный токен.</p>
        <div className="max-w-[520px]"><Field label="Токен бота"><input className="input" value={f.tg_token || ''} onChange={set('tg_token')} placeholder="123456789:AA…" autoComplete="off" /></Field></div>
        {st.telegram.bot && <p className="text-[12.5px] text-ink-3 mt-2">Ссылка для клиентов: <a href={`https://t.me/${st.telegram.bot}`} target="_blank" rel="noreferrer" className="text-violet hover:underline">t.me/{st.telegram.bot}</a></p>}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold">WhatsApp — Green API</h2>
          <ChannelState s={st.whatsapp} okText="номер авторизован" />
        </div>
        <p className="text-[13px] text-ink-2 mt-1 mb-4">Зарегистрируйтесь на <a href="https://green-api.com" target="_blank" rel="noreferrer" className="text-violet hover:underline">green-api.com</a>, создайте инстанс и отсканируйте QR-код телефоном с WhatsApp рабочего номера.
          Скопируйте из личного кабинета apiUrl, idInstance и apiTokenInstance. Поле Webhook URL в Green API оставьте пустым — CRM сама забирает сообщения.</p>
        <div className="grid sm:grid-cols-3 gap-3.5">
          <Field label="apiUrl"><input className="input" value={f.wa_api_url || ''} onChange={set('wa_api_url')} placeholder="https://api.green-api.com" /></Field>
          <Field label="idInstance"><input className="input" value={f.wa_id_instance || ''} onChange={set('wa_id_instance')} placeholder="1101000001" /></Field>
          <Field label="apiTokenInstance"><input className="input" value={f.wa_api_token || ''} onChange={set('wa_api_token')} autoComplete="off" /></Field>
        </div>
        {st.whatsapp.connected && (
          <div className="flex gap-2 mt-3 max-w-[520px]">
            <input className="input" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Ваш номер для проверки: 7928…" />
            <Button onClick={test}>Пробное сообщение</Button>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-semibold">Сообщения клиентам</h2>
        <p className="text-[13px] text-ink-2 mt-1 mb-4">Каждое новое обращение создаёт заявку; следующие сообщения добавляются в неё, пока заявка открыта. <code>{'{номер}'}</code> заменяется номером заявки. Пустое поле — сообщение не отправляется.</p>
        <div className="grid gap-3.5">
          <Field label="Приветствие в Telegram (на /start)"><textarea className="input" rows={2} value={f.msg_greeting || ''} onChange={set('msg_greeting')} placeholder="Здравствуйте! Опишите, пожалуйста, вашу проблему или вопрос — мы создадим заявку и ответим здесь." /></Field>
          <Field label="Автоответ при создании заявки"><textarea className="input" rows={2} value={f.msg_autoreply || ''} onChange={set('msg_autoreply')} placeholder="Заявка №{номер} принята. Специалист ответит в ближайшее время." /></Field>
          <Field label="Сообщение, когда заявка решена"><textarea className="input" rows={2} value={f.msg_resolved || ''} onChange={set('msg_resolved')} placeholder="Заявка №{номер} выполнена. Если вопрос остался — просто напишите сюда." /></Field>
          <div className="max-w-[420px]"><Field label="Проект для новых заявок" hint="Необязательно"><ProjectSelect value={f.msg_project_id ? +f.msg_project_id : null} onChange={(v) => setF((x) => ({ ...x, msg_project_id: v ? String(v) : '' }))} placeholder="—" /></Field></div>
        </div>
        <div className="flex gap-2 mt-5">
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
          <Button onClick={check}>Проверить подключение</Button>
        </div>
        {!d.public_url && <p className="text-[12px] text-ink-3 mt-3">Ссылки «Открыть в CRM» в уведомлениях появятся после сохранения настроек с рабочего адреса CRM.</p>}
      </Card>
    </>
  );
}

function MyTelegram() {
  const { toast } = useApp();
  const [d, setD] = useState(null);
  const load = () => api.get('/messengers/telegram/me').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!d?.bot) return null;
  const connect = async () => {
    try { const { url } = await api.post('/messengers/telegram/link'); window.open(url, '_blank'); toast('Нажмите «Запустить» в Telegram, затем обновите страницу'); } catch (e) { toast(e.message, 'error'); }
  };
  const disconnect = async () => { await api.del('/messengers/telegram/link'); load(); };
  const toggle = async () => { try { await api.put('/auth/me', { tg_notify: !d.notify }); load(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Card className="p-6 mt-4">
      <h2 className="text-[15px] font-semibold mb-1">Уведомления в Telegram</h2>
      <p className="text-[12.5px] text-ink-3 mb-3">Новые заявки (для руководителей), назначенные вам задачи и заявки, упоминания, сообщения клиентов и просроченный SLA — от бота @{d.bot}.</p>
      {d.linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-600 font-medium"><span className="size-2 rounded-full bg-emerald-500" />Подключено</span>
          <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={d.notify} onChange={toggle} className="accent-[var(--color-brand)]" />Присылать уведомления</label>
          <Button size="sm" variant="ghost" onClick={disconnect}>Отключить</Button>
        </div>
      ) : (
        <div className="flex gap-2"><Button variant="primary" onClick={connect}>Подключить Telegram</Button><Button onClick={load}>Я подключил</Button></div>
      )}
    </Card>
  );
}

function DaData() {
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

function MyLogins() {
  const { data } = useLoad('/auth/logins');
  if (!data?.length) return null;
  return (
    <Card className="p-6 mt-4">
      <h2 className="text-[15px] font-semibold mb-1">Последние входы</h2>
      <p className="text-[12.5px] text-ink-3 mb-3">Если видите вход, который делали не вы, — смените пароль.</p>
      <div className="divide-y divide-line">
        {data.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
            <span className={cx('size-2 rounded-full', r.ok ? 'bg-emerald-500' : 'bg-red-500')} />
            <span className="w-36 tabular">{fmtDateTime(r.created_at)}</span><span className="flex-1 text-ink-2">{shortUA(r.user_agent)}</span><span className="text-ink-3 tabular">{r.ip}</span>
            {!r.ok && <span className="text-red-600 text-[12px]">неверный пароль</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
