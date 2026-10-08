import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Ticket, Timer, Users, Building2, Handshake, Wallet, Settings, LogOut, Search,
  Moon, Sun, CalendarDays, Package, Receipt, BarChart3, Monitor, BookOpen, Pin, PinOff, Plus, X, Play, Pause, Square, Bell, Menu, ChevronDown, Command, FileText, ListTodo,
} from 'lucide-react';
import { useApp, useLoad, useNow, useStored, timerSeconds } from '../lib/store';
import { api } from '../lib/api';
import { Avatar, IconButton, Popover, MenuItem, Odometer, cx } from './ui';
import { fmtHMS, timeAgo } from '../lib/format';
import { TimerStartModal } from './TimerStart';
import { WorkReportModal } from './WorkReport';
import { ROLES, PROJECT_STATUS, TICKET_STATUS, DEAL_STAGE } from '../lib/constants';

const NAV = [
  { section: 'Управление', items: [
    { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true },
    { to: '/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/tickets', label: 'Заявки', icon: Ticket, badge: 'tickets' },
    { to: '/calendar', label: 'Календарь', icon: CalendarDays },
    { to: '/time', label: 'Учёт времени', icon: Timer },
    { to: '/assets', label: 'Оборудование', icon: Monitor },
    { to: '/kb', label: 'База знаний', icon: BookOpen },
    { to: '/team', label: 'Команда', icon: Users },
  ] },
  { section: 'Продажи', items: [
    { to: '/clients', label: 'Клиенты', icon: Building2 },
    { to: '/pipeline', label: 'Воронка сделок', icon: Handshake },
    { to: '/invoices', label: 'Счета', icon: Receipt, manager: true, badge: 'invoices' },
    { to: '/catalog', label: 'Каталог', icon: Package },
  ] },
  { section: 'Финансы', manager: true, items: [
    { to: '/finance', label: 'Доходы и расходы', icon: Wallet },
    { to: '/reports', label: 'Отчёты', icon: BarChart3 },
  ] },
];

const TITLES = { '/': 'Дашборд', '/projects': 'Проекты', '/tickets': 'Заявки', '/time': 'Учёт времени', '/team': 'Команда',
  '/clients': 'Клиенты', '/pipeline': 'Воронка сделок', '/finance': 'Финансы', '/settings': 'Настройки', '/calendar': 'Календарь', '/catalog': 'Каталог', '/invoices': 'Счета', '/reports': 'Отчёты', '/assets': 'Оборудование', '/kb': 'База знаний' };

export default function Layout() {
  const { user, isManager, projects, logout } = useApp();
  const [pinned, setPinned] = useStored('crm.sidebar.pinned', false);
  const [theme, setTheme] = useStored('crm.theme', 'light');
  useEffect(() => {
    const el = document.documentElement;
    if (el.classList.contains('dark') === (theme === 'dark')) return;
    el.classList.add('theme-anim');
    el.classList.toggle('dark', theme === 'dark');
    const t = setTimeout(() => el.classList.remove('theme-anim'), 350);
    return () => clearTimeout(t);
  }, [theme]);
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

  const items = NAV.filter((s) => !s.manager || isManager);
  const navItem = (i) => (
    <NavLink key={i.to} to={i.to} end={i.end} title={i.label} className={({ isActive }) => cx('sb-item', isActive && 'active')}>
      <i.icon className="sb-ico" size={22} strokeWidth={1.75} />
      <span className="sb-fade">{i.label}</span>
      {i.badge === 'tickets' && dash?.tickets?.new > 0 && <b className="sb-badge">{dash.tickets.new}</b>}
      {i.badge === 'invoices' && dash?.invoices?.overdue > 0 && <b className="sb-badge !bg-red-500" title="Просроченные счета">{dash.invoices.overdue}</b>}
    </NavLink>
  );

  const sidebar = (open, mobile = false) => (
    <aside className={cx('sb', open && 'sb-open', mobile && 'anim-slide-left')} onClick={mobile ? (e) => e.stopPropagation() : undefined}>
      {/* Профиль */}
      <div className="sb-profile">
      <button onClick={() => nav('/settings')} className="flex items-center gap-3 flex-1 min-w-0 text-left" title="Профиль и настройки">
        <span className="relative shrink-0">
          <Avatar user={user} size={44} ring={false} />
          <span className="absolute bottom-0 right-0 size-3 rounded-full bg-emerald-500 ring-2 ring-panel" />
        </span>
        <span className="sb-fade flex-1 min-w-0">
          <span className="block text-[14.5px] font-semibold text-ink truncate">{user.name}</span>
          <span className="block text-[12.5px] text-ink-3">{ROLES[user.role]}</span>
        </span>
      </button>
      {!mobile && (
        <button onClick={() => setPinned((v) => !v)} title={pinned ? 'Открепить меню' : 'Закрепить меню открытым'}
          className={cx('sb-fade shrink-0 size-8 rounded-lg grid place-items-center', pinned ? 'text-brand bg-brand/10' : 'text-ink-3 hover:text-ink hover:bg-canvas')}>
          {pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      )}
      </div>

      {/* Поиск */}
      <div className="sb-search" role="button" tabIndex={0} title="Поиск (Ctrl+K)" onClick={() => setSearchOpen(true)} onKeyDown={(e) => e.key === 'Enter' && setSearchOpen(true)}>
        <span className="sb-ph sb-fade">Поиск по CRM…</span>
        <Search size={19} strokeWidth={1.75} />
      </div>

      {/* Разделы */}
      <nav className="sb-nav">
        {items.map((s, k) => (
          <div key={s.section} className="contents">
            {k > 0 && <div className="sb-hr" />}
            {s.items.filter((i) => !i.manager || isManager).map(navItem)}
          </div>
        ))}
        {starredProjects.length > 0 && (<>
          <div className="sb-hr" />
          {starredProjects.slice(0, 6).map((p) => (
            <button key={p.id} onClick={() => nav(`/projects?open=${p.id}`)} className="sb-item" title={p.name}>
              <span className="sb-letter" style={{ background: PROJECT_STATUS[p.status]?.color || 'var(--color-brand)' }}>{p.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase()}</span>
              <span className="sb-fade truncate pr-2">{p.name}</span>
            </button>
          ))}
        </>)}
      </nav>

      {/* Действия */}
      <div className="sb-actions">
        <button className="sb-action sb-theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
              <Moon className="moon" size={19} strokeWidth={1.75} /><Sun className="sun" size={19} strokeWidth={1.75} />
            </button>
        <button className="sb-action" onClick={() => nav('/settings')} title="Настройки"><Settings size={19} strokeWidth={1.75} /></button>
        <button className="sb-action" onClick={() => nav('/projects?newtask=1')} title="Новая задача"><Plus size={20} strokeWidth={1.75} /></button>
        <button className="sb-action" onClick={logout} title="Выйти"><LogOut size={19} strokeWidth={1.75} /></button>
      </div>
    </aside>
  );

  return (
    <div className="h-full flex">
      <div className="hidden lg:block">{sidebar(pinned)}</div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink/25 anim-fade" onClick={() => setMobileOpen(false)}>
          {sidebar(true, true)}
        </div>
      )}
      <div className={cx('flex-1 min-w-0 flex flex-col transition-[padding] duration-300', pinned ? 'lg:pl-[296px]' : 'lg:pl-[116px]')}>
        <Topbar crumb={crumb} onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} dash={dash} />
        <main className="flex-1 overflow-y-auto">
          <div key={loc.pathname} className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6 page-enter"><Outlet /></div>
        </main>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <WorkReportModal />
    </div>
  );
}

function Topbar({ crumb, onMenu, onSearch, dash }) {
  const { timer, stopTimer: rawStop, pauseTimer, resumeTimer, askWork } = useApp();
  // Таймер по задаче останавливаем через отчёт «Приостановить задачу»
  const stopTimer = () => (timer?.task_id ? askWork({ id: timer.task_id, title: timer.task_title }, 'pause') : rawStop());
  const [startOpen, setStartOpen] = useState(false);
  const now = useNow();
  const elapsed = timerSeconds(timer, now);
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
          <div className={cx('flex items-center gap-1 h-10 pl-1.5 pr-1.5 rounded-full forest-pattern text-white shadow-[0_10px_22px_-12px_rgba(14,47,32,.9)]', timer.paused && 'opacity-90')}
            title={timer.task_title || timer.ticket_title || timer.project_name || 'Таймер'}>
            <button onClick={timer.paused ? resumeTimer : pauseTimer} title={timer.paused ? 'Продолжить' : 'Пауза'}
              className="size-7 rounded-full bg-white text-forest flex items-center justify-center hover:scale-105 transition-transform">
              {timer.paused ? <Play size={12} fill="currentColor" className="ml-0.5" /> : <Pause size={12} fill="currentColor" />}
            </button>
            <Odometer value={fmtHMS(elapsed)} className={cx('px-2 font-semibold text-[14px]', timer.paused && 'animate-pulse')} />
            <button onClick={stopTimer} title="Остановить и записать в табель"
              className="size-7 rounded-full bg-red-500 flex items-center justify-center hover:scale-105 transition-transform">
              <Square size={10} fill="currentColor" />
            </button>
          </div>
        ) : (
          <button onClick={() => setStartOpen(true)}
            className="flex items-center gap-2 h-10 pl-1.5 pr-4 rounded-full forest-pattern text-white font-semibold text-[13.5px] shadow-[0_10px_22px_-12px_rgba(14,47,32,.9)] hover:brightness-110 transition">
            <span className="size-7 rounded-full bg-white text-forest flex items-center justify-center"><Play size={12} fill="currentColor" /></span>
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
  asset: { icon: Monitor, label: 'Оборудование', url: (r) => `/assets?open=${r.id}`, sub: (r) => r.sub },
  kb: { icon: BookOpen, label: 'База знаний', url: (r) => `/kb?open=${r.id}`, sub: (r) => r.sub },
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

