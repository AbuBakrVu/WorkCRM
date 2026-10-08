import { useEffect, useState } from 'react';
import { Bookmark, BookmarkPlus, Users, Trash2, Check } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { Popover, cx } from './ui';

// Сохранённые фильтры страницы: state — текущие фильтры, apply(state) — применить сохранённый
export function SavedViews({ page, state, apply }) {
  const { toast, user } = useApp();
  const [views, setViews] = useState([]);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const load = () => api.get(`/views?page=${page}`).then(setViews).catch(() => {});
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = JSON.stringify(state);
  const active = views.find((v) => JSON.stringify(v.state) === cur);
  const save = async () => {
    if (!name.trim()) return;
    try { await api.post('/views', { page, name: name.trim(), state, shared }); setName(''); setShared(false); load(); toast('Фильтр сохранён'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (v) => { try { await api.del(`/views/${v.id}`); load(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Popover width={290} trigger={({ toggle }) => (
      <button className={cx('chip', active && 'chip-active')} onClick={toggle} title="Сохранённые фильтры">
        <Bookmark size={15} className={active ? 'fill-current text-brand' : ''} />{active ? active.name : 'Фильтры'}
      </button>
    )}>
      {({ close }) => (<>
        {views.length > 0 && <div className="max-h-64 overflow-y-auto mb-1">
          {views.map((v) => (
            <div key={v.id} className="group flex items-center gap-1 rounded-lg hover:bg-canvas">
              <button onClick={() => { apply(v.state); close(); }} className="flex-1 flex items-center gap-2 px-2.5 h-9 text-[13px] text-left min-w-0">
                {v.shared ? <Users size={14} className="text-ink-3 shrink-0" title="Общий" /> : <Bookmark size={14} className="text-ink-3 shrink-0" />}
                <span className="truncate flex-1">{v.name}</span>
                {!v.mine && <span className="text-[11px] text-ink-3 truncate max-w-20">{v.user_name.split(' ')[0]}</span>}
                {active?.id === v.id && <Check size={14} className="text-violet" />}
              </button>
              {(v.mine || user.role === 'admin') && <button onClick={() => remove(v)} className="opacity-0 group-hover:opacity-100 p-2 text-ink-3 hover:text-red-600" title="Удалить"><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>}
        <div className={cx('p-1.5', views.length > 0 && 'border-t border-line pt-2')}>
          <div className="text-[11.5px] text-ink-3 mb-1.5 px-1">Сохранить текущие фильтры</div>
          <div className="flex gap-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
              placeholder="Например: Мои просроченные" className="input !h-8 flex-1" />
            <button onClick={save} disabled={!name.trim()} className="size-8 grid place-items-center rounded-lg bg-brand text-white disabled:opacity-40" title="Сохранить"><BookmarkPlus size={15} /></button>
          </div>
          <label className="flex items-center gap-2 mt-2 px-1 text-[12px] text-ink-2"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-[var(--color-brand)]" />Показать всей команде</label>
        </div>
      </>)}
    </Popover>
  );
}
