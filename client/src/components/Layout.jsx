import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Ticket, Timer, Users, Building2, Handshake, Wallet, Settings, LogOut, Search,
  ChevronsLeft, Play, Square, Bell, Menu, ChevronDown, Command, FileText, ListTodo,
} from 'lucide-react';
import { useApp, useLoad, useNow, useStored } from '../lib/store';
import { api } from '../lib/api';
import { Avatar, IconButton, Popover, MenuItem, cx } from './ui';
import { fmtHMS, timeAgo } from '../lib/format';
import { TimerStartModal } from './TimerStart';
import { ROLES, PROJECT_STATUS, TICKET_STATUS, DEAL_STAGE } from '../lib/constants';

const NAV = [
  { section: 'Управление', items: [
    { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true },
    { to: '/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/tickets', label: 'Заявки', icon: Ticket, badge: 'tickets' },
    { to: '/time', label: 'Учёт времени', icon: Timer },
    { to: '/team', label: 'Команда', icon: Users },
  ] },
  { section: 'Продажи', items: [
    { to: '/clients', label: 'Клиенты', icon: Building2 },
    { to: '/pipeline', label: 'Воронка сделок', icon: Handshake },
  ] },
  { section: 'Финансы', manager: true, items: [
    { to: '/finance', label: 'Доходы и расходы', icon: Wallet },
  ] },
];

const TITLES = { '/': 'Дашборд', '/projects': 'Проекты', '/tickets': 'Заявки', '/time': 'Учёт времени', '/team': 'Команда',
  '/clients': 'Клиенты', '/pipeline': 'Воронка сделок', '/finance': 'Финансы', '/settings': 'Настройки' };

export default function Layout() {
  const { user, isManager, projects, logout } = useApp();
  const [collapsed, setCollapsed] = useStored('crm.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [starred] = useStored('crm.starred', []);
  const loc = useLocation();
  const nav = useNavigate();
  const { data: dash } = useLoad('/dashboard');

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const starredProjects = projects.filter((p) => starred.includes(p.id));
  const crumb = TITLES['/' + (loc.pathname.split('/')[1] || '')] || '';

  const sidebar = (
    <aside className={cx('flex h-full bg-side border-r border-line', collapsed ? 'w-[68px]' : 'w-[264px]')}>
      {/* Иконка-рейл */}
      <div className="w-[60px] shrink-0 flex flex-col items-center py-4 gap-3 border-r border-line">
        <div className="size-9 rounded-full bg-brand flex items-center justify-center text-brand-ink shadow-sm">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="9.5" y="2.5" width="5" height="5" rx="1.3" transform="rotate(45 12 5)"/><rect x="9.5" y="16.5" width="5" height="5" rx="1.3" transform="rotate(45 12 19)"/><rect x="2.5" y="9.5" width="5" height="5" rx="1.3" transform="rotate(45 5 12)"/><rect x="16.5" y="9.5" width="5" height="5" rx="1.3" transform="rotate(45 19 12)"/></svg>
        </div>
        <div className="w-6 h-px bg-line my-1" />
        {[['/tickets', Ticket, 'Заявки'], ['/time', Timer, 'Учёт времени'], ['/pipeline', Handshake, 'Воронка']].map(([to, I, t]) => (
          <NavLink key={to} to={to} title={t} className={({ isActive }) => cx('size-9 rounded-full flex items-center justify-center transition-colors', isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas')}>
            <I size={17} />
          </NavLink>
        ))}
        <div className="flex-1" />
        <NavLink to="/settings" title="Настройки" className="size-9 rounded-full flex items-center justify-center text-ink-2 hover:bg-canvas"><Settings size={17} /></NavLink>
        <Popover align="left" width={220} trigger={({ toggle }) => (
          <button onClick={toggle} className="relative"><Avatar user={user} size={36} ring={false} /><span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-side" /></button>
        )}>
          {({ close }) => (<>
            <div className="px-2.5 py-2 border-b border-line mb-1">
              <div className="text-[13px] font-semibold truncate">{user.name}</div>
              <div className="text-[12px] text-ink-3">{ROLES[user.role]}</div>
            </div>
            <MenuItem icon={Settings} onClick={() => { close(); nav('/settings'); }}>Профиль и пароль</MenuItem>
            <MenuItem icon={LogOut} danger onClick={logout}>Выйти</MenuItem>
          </>)}
        </Popover>
      </div>

      {/* Основное меню */}
      {!collapsed && (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 h-[60px]">
            <div className="flex-1 flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-panel text-[13px] font-semibold truncate">
              <span className="truncate">Моя компания</span><ChevronDown size={14} className="text-ink-3 shrink-0" />
            </div>
            <button onClick={() => setSearchOpen(true)} className="p-1.5 rounded-lg hover:bg-canvas text-ink-2" title="Поиск (Ctrl+K)"><Search size={17} /></button>
          </div>
          <button onClick={() => setCollapsed(true)} className="hidden lg:flex absolute left-[250px] top-[66px] z-10 size-6 rounded-md border border-line bg-panel items-center justify-center text-ink-3 hover:text-ink" title="Свернуть меню">
            <ChevronsLeft size={14} />
          </button>
          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {NAV.filter((s) => !s.manager || isManager).map((s) => (
              <div key={s.section} className="mt-3">
                <div className="px-2 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink">{s.section}</div>
                {s.items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end}
                    className={({ isActive }) => cx('flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-[13.5px] transition-colors',
                      isActive ? 'bg-panel text-ink font-medium shadow-[0_1px_2px_rgba(16,24,40,.06)] border border-line' : 'text-ink-2 hover:bg-canvas border border-transparent')}>
                    <i.icon size={17} strokeWidth={1.8} />
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.badge === 'tickets' && dash?.tickets?.new > 0 && <span className="text-[11px] font-semibold text-white bg-violet rounded-full px-1.5 min-w-5 text-center">{dash.tickets.new}</span>}
                  </NavLink>
                ))}
              </div>
            ))}
            <div className="mt-4">
              <div className="flex items-center gap-1 px-2 mb-1.5 text-[11.5px] font-medium text-ink">
                <ChevronDown size={13} /> Избранное
              </div>
              {starredProjects.length === 0 && <div className="px-2.5 text-[12px] text-ink-3">Отметьте проект звёздочкой</div>}
              {starredProjects.map((p) => (
                <button key={p.id} onClick={() => nav(`/projects?open=${p.id}`)} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-lg text-[13px] text-ink-2 hover:bg-canvas text-left">
                  <span className="size-1.5 rounded-full shrink-0" style={{ background: PROJECT_STATUS[p.status]?.color }} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}
      {collapsed && (
        <button onClick={() => setCollapsed(false)} className="hidden lg:flex absolute left-[54px] top-[66px] z-10 size-6 rounded-md border border-line bg-panel items-center justify-center text-ink-3 rotate-180" title="Развернуть меню">
          <ChevronsLeft size={14} />
        </button>
      )}
    </aside>
  );

  return (
    <div className="h-full flex">
      <div className="hidden lg:block relative shrink-0">{sidebar}</div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink/25 anim-fade" onClick={() => setMobileOpen(false)}>
          <div className="h-full w-fit relative" onClick={(e) => e.stopPropagation()}>{sidebar}</div>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar crumb={crumb} onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} dash={dash} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6"><Outlet /></div>
        </main>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function Topbar({ crumb, onMenu, onSearch, dash }) {
  const { timer, stopTimer } = useApp();
  const [startOpen, setStartOpen] = useState(false);
  const now = useNow();
  const elapsed = timer ? (now - new Date(timer.started_at)) / 1000 : 0;
  return (
    <header className="h-[60px] shrink-0 flex items-center gap-3 px-4 sm:px-6 border-b border-line bg-panel">
      <button onClick={onMenu} className="lg:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-canvas"><Menu size={20} /></button>
      <div className="text-[13.5px] font-medium text-ink-2 min-w-0 truncate">{crumb}</div>
      <div className="flex-1 flex justify-center">
        <button onClick={onSearch} className="hidden md:flex items-center gap-2 w-[300px] h-9 px-3 rounded-xl border border-violet/25 bg-panel text-ink-3 text-[13px] hover:border-violet/50 shadow-[0_0_0_3px_rgba(109,94,246,.05)]">
          <Search size={15} className="text-violet" />
          <span className="flex-1 text-left">Поиск по CRM…</span>
          <span className="flex items-center gap-0.5 text-[11px] text-ink-3"><Command size={11} />K</span>
        </button>
      </div>
      <div className="flex items-center gap-2">
        <IconButton icon={Search} title="Поиск" onClick={onSearch} className="md:hidden" />
        <NotificationsButton activity={dash?.activity} />
        {timer ? (
          <button onClick={stopTimer} title={timer.project_name || timer.ticket_title || 'Таймер'}
            className="flex items-center gap-2 h-9 pl-2 pr-3.5 rounded-full bg-violet text-white font-semibold text-[13px] shadow-[0_6px_16px_-6px_rgba(109,94,246,.7)] hover:bg-violet/90">
            <span className="size-6 rounded-full bg-white/20 flex items-center justify-center"><Square size={11} fill="currentColor" /></span>
            <span className="tabular">{fmtHMS(elapsed)}</span>
          </button>
        ) : (
          <button onClick={() => setStartOpen(true)}
            className="flex items-center gap-2 h-9 pl-2 pr-3.5 rounded-full bg-violet text-white font-semibold text-[13px] shadow-[0_6px_16px_-6px_rgba(109,94,246,.7)] hover:bg-violet/90">
            <span className="size-6 rounded-full bg-white/20 flex items-center justify-center"><Play size={11} fill="currentColor" /></span>
            <span className="hidden sm:inline">Таймер</span>
          </button>
        )}
      </div>
      <TimerStartModal open={startOpen} onClose={() => setStartOpen(false)} />
    </header>
  );
}

function NotificationsButton({ activity }) {
  const [seen, setSeen] = useStored('crm.activity.seen', 0);
  const latest = activity?.[0]?.id || 0;
  const unread = activity ? activity.filter((a) => a.id > seen).length : 0;
  return (
    <Popover align="right" width={340} trigger={({ toggle }) => (
      <IconButton icon={Bell} title="Активность" badge={unread || null} onClick={() => { toggle(); setSeen(latest); }} />
    )}>
      <div className="px-2.5 pt-1.5 pb-2 text-[13px] font-semibold">Последние события</div>
      <div className="max-h-96 overflow-y-auto">
        {(activity || []).map((a) => (
          <div key={a.id} className="flex gap-2.5 px-2.5 py-2 rounded-lg hover:bg-canvas">
            <Avatar user={{ name: a.user_name || '?', color: a.user_color }} size={26} ring={false} />
            <div className="min-w-0 text-[12.5px] leading-snug">
              <span className="font-medium text-ink">{a.user_name}</span> <span className="text-ink-2">{a.text}</span>
              <div className="text-[11px] text-ink-3 mt-0.5">{timeAgo(a.created_at)}</div>
            </div>
          </div>
        ))}
        {!activity?.length && <div className="px-2.5 py-6 text-center text-ink-3 text-[13px]">Пока пусто</div>}
      </div>
    </Popover>
  );
}

const KIND = {
  project: { icon: FolderKanban, label: 'Проект', url: (r) => `/projects?open=${r.id}`, sub: (r) => PROJECT_STATUS[r.sub]?.label },
  ticket: { icon: Ticket, label: 'Заявка', url: (r) => `/tickets?open=${r.id}`, sub: (r) => `#${r.id} · ${TICKET_STATUS[r.sub]?.label}` },
  client: { icon: Building2, label: 'Клиент', url: (r) => `/clients?open=${r.id}`, sub: (r) => r.sub },
  deal: { icon: Handshake, label: 'Сделка', url: () => '/pipeline', sub: (r) => DEAL_STAGE[r.sub]?.label },
  task: { icon: ListTodo, label: 'Задача', url: (r) => `/projects?open=${r.project_id}&task=${r.id}`, sub: (r) => r.sub },
};

function SearchModal({ open, onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const nav = useNavigate();
  useEffect(() => { if (open) { setQ(''); setRes([]); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api.get(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setRes(r); setIdx(0); }).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q]);
  const go = (r) => { onClose(); nav(KIND[r.kind].url(r)); };
  const quick = useMemo(() => [
    { label: 'Новая задача', to: '/projects?newtask=1', icon: ListTodo },
    { label: 'Новая заявка', to: '/tickets?new=1', icon: Ticket },
    { label: 'Новый проект', to: '/projects?new=1', icon: FolderKanban },
    { label: 'Новый клиент', to: '/clients?new=1', icon: Building2 },
    { label: 'Добавить время', to: '/time?new=1', icon: Timer },
  ], []);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink/25 flex items-start justify-center pt-[12vh] p-4 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[560px] bg-panel rounded-2xl shadow-2xl overflow-hidden anim-pop">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line">
          <Search size={18} className="text-violet" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Проекты, заявки, клиенты, задачи…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, res.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && res[idx]) go(res[idx]);
            }}
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-ink-3" />
          <kbd className="text-[11px] text-ink-3 border border-line rounded px-1.5">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {q.trim().length < 2 ? (
            <>
              <div className="px-2 py-1.5 text-[11.5px] font-medium text-ink-3">Быстрые действия</div>
              {quick.map((a) => (
                <button key={a.to} onClick={() => { onClose(); nav(a.to); }} className="w-full flex items-center gap-3 px-2.5 h-10 rounded-lg hover:bg-canvas text-[13.5px] text-ink-2">
                  <a.icon size={16} /> {a.label}
                </button>
              ))}
            </>
          ) : res.length === 0 ? (
            <div className="py-10 text-center text-ink-3 text-[13px]"><FileText size={20} className="mx-auto mb-2" />Ничего не найдено</div>
          ) : res.map((r, i) => {
            const K = KIND[r.kind];
            return (
              <button key={r.kind + r.id} onMouseEnter={() => setIdx(i)} onClick={() => go(r)}
                className={cx('w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left', i === idx ? 'bg-canvas' : '')}>
                <span className="size-8 rounded-lg bg-canvas border border-line flex items-center justify-center text-ink-2"><K.icon size={15} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] text-ink truncate">{r.title}</span>
                  <span className="block text-[11.5px] text-ink-3 truncate">{K.label}{K.sub(r) ? ` · ${K.sub(r)}` : ''}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

