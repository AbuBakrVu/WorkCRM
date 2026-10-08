import { useState } from 'react';
import { Trash2, RotateCcw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Empty, Spinner, ConfirmButton, Avatar, Segmented, cx, userOptions, Select } from './ui';

const ENTITY = { task: 'Задача', project: 'Проект', client: 'Клиент', deal: 'Сделка', ticket: 'Заявка', invoice: 'Счёт', contract: 'Абонентка', transaction: 'Операция' };

export function TrashSettings() {
  const { data, reload } = useLoad('/trash');
  const { toast, bump, user } = useApp();
  if (!data) return <Spinner />;
  const restore = async (t) => { try { await api.post(`/trash/${t.id}/restore`); toast(`Восстановлено: ${t.title || ENTITY[t.entity]}`); reload(); bump(); } catch (e) { toast(e.message, 'error'); } };
  const purge = async (t) => { try { await api.del(`/trash/${t.id}`); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div>
      <p className="text-[13px] text-ink-2 mb-3">Удалённые задачи, проекты, клиенты, сделки, заявки и счета хранятся здесь 30 дней — вместе с комментариями, файлами и чек-листами. Потом удаляются навсегда.</p>
      {!data.length ? <Card><Empty icon={Trash2} title="Корзина пуста" /></Card> : (
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-canvas/60 border-b border-line"><th className="th">Что</th><th className="th">Название</th><th className="th">Удалил</th><th className="th">Когда</th><th className="th w-48" /></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="td">{ENTITY[t.entity] || t.entity}</td>
                  <td className="td whitespace-normal text-ink">{t.title || `#${t.entity_id}`}</td>
                  <td className="td">{t.deleted_by_name || '—'}</td>
                  <td className="td">{fmtDateTime(t.deleted_at)}</td>
                  <td className="td"><div className="flex justify-end gap-2">
                    <Button size="sm" icon={RotateCcw} onClick={() => restore(t)}>Восстановить</Button>
                    {user.role === 'admin' && <ConfirmButton onConfirm={() => purge(t)}>Навсегда</ConfirmButton>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// Браузер и ОС из user-agent — коротко
export function shortUA(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /YaBrowser/.test(ua) ? 'Яндекс.Браузер' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : 'Браузер';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b}, ${os}` : b;
}

export function AuthLogSettings() {
  const { users } = useApp();
  const [who, setWho] = useState(null);
  const [only, setOnly] = useState('all');
  const { data } = useLoad(`/auth-log?${who ? `user_id=${who}&` : ''}${only === 'failed' ? 'failed=1' : ''}`, [who, only]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="w-60"><Select value={who} onChange={(v) => setWho(v)} placeholder="Все сотрудники" search options={userOptions(users, { all: true })} /></div>
        <Segmented value={only} onChange={setOnly} items={[{ value: 'all', label: 'Все входы' }, { value: 'failed', label: 'Неудачные' }]} />
      </div>
      {!data ? <Spinner /> : !data.length ? <Card><Empty icon={ShieldCheck} title="Записей нет" /></Card> : (
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-canvas/60 border-b border-line"><th className="th">Когда</th><th className="th">Кто</th><th className="th">Результат</th><th className="th">IP-адрес</th><th className="th">Устройство</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={cx('border-b border-line last:border-0', !r.ok && 'bg-red-50/50')}>
                  <td className="td tabular">{fmtDateTime(r.created_at)}</td>
                  <td className="td">{r.user_name ? <span className="flex items-center gap-2"><Avatar user={{ name: r.user_name, color: r.user_color }} size={22} ring={false} />{r.user_name}</span> : <span className="text-ink-3">{r.email || '—'}</span>}</td>
                  <td className="td">{r.ok ? <span className="inline-flex items-center gap-1.5 text-emerald-600"><ShieldCheck size={14} />Успешно</span> : <span className="inline-flex items-center gap-1.5 text-red-600"><ShieldAlert size={14} />Неверный пароль</span>}</td>
                  <td className="td tabular">{r.ip || '—'}</td>
                  <td className="td" title={r.user_agent}>{shortUA(r.user_agent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
