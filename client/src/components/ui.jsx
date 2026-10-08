import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { X, ChevronDown, Check, ArrowUpRight, Search } from 'lucide-react';
import { initials } from '../lib/format';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function Button({ variant = 'default', size = 'md', className, children, icon: Icon, ...p }) {
  const v = {
    primary: 'bg-brand text-brand-ink hover:bg-brand-strong border-transparent font-semibold',
    dark: 'bg-ink text-white hover:bg-ink/90 border-transparent',
    default: 'bg-panel text-ink-2 hover:bg-canvas hover:text-ink border-line',
    ghost: 'bg-transparent text-ink-2 hover:bg-canvas border-transparent',
    danger: 'bg-panel text-red-600 hover:bg-red-50 border-red-200',
    violet: 'bg-violet text-white hover:bg-violet/90 border-transparent font-semibold',
  }[variant];
  const s = { sm: 'h-8 px-3 text-[12.5px]', md: 'h-9 px-3.5 text-[13px]', lg: 'h-10 px-4 text-sm' }[size];
  return (
    <button {...p} className={cx('inline-flex items-center justify-center gap-1.5 rounded-full border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap', v, s, className)}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, className, size = 36, badge, title, ...p }) {
  return (
    <button {...p} title={title} aria-label={title}
      className={cx('relative inline-flex items-center justify-center rounded-full border border-line bg-panel text-ink-2 hover:bg-canvas hover:text-ink transition-colors', className)}
      style={{ width: size, height: size }}>
      <Icon size={17} strokeWidth={1.9} />
      {badge ? <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-[9.5px] leading-4 font-bold text-white">{badge}</span> : null}
    </button>
  );
}

export function StatusDot({ color, label, className }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-[13px] text-ink-2', className)}>
      <span className="size-3.5 rounded-[4px] shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}

export function Pill({ color, bg, children, className }) {
  return <span className={cx('inline-flex items-center h-6 px-2 rounded-md text-[12px] font-medium', className)} style={{ color, background: bg }}>{children}</span>;
}

export function Progress({ value = 0, color, showLabel = true, width = 'w-14' }) {
  const v = Math.max(0, Math.min(100, value));
  const c = color || (v >= 100 ? 'var(--color-st-done)' : v >= 50 ? 'var(--color-st-progress)' : v >= 25 ? 'var(--color-st-stuck)' : 'var(--color-st-review)');
  return (
    <div className="flex items-center gap-3">
      <div className={cx('h-1.5 rounded-full bg-line overflow-hidden', width)}>
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: c }} />
      </div>
      {showLabel && <span className="text-[12.5px] text-ink-2 tabular w-9 text-right">{v}%</span>}
    </div>
  );
}

export function Avatar({ user, size = 26, ring = true, className, style }) {
  if (!user) return <span className={cx('inline-flex items-center justify-center rounded-full bg-line text-ink-3 text-[10px]', className)} style={{ width: size, height: size }}>—</span>;
  return (
    <span title={user.name}
      className={cx('inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 select-none', ring && 'ring-2 ring-panel', className)}
      style={{ width: size, height: size, background: user.color || '#64748b', fontSize: size * 0.38, ...style }}>
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 3, size = 26 }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((u, i) => <Avatar key={u.id} user={u} size={size} className="relative" style={{ zIndex: shown.length - i }} />)}
      {rest > 0 && <span className="inline-flex items-center justify-center rounded-full bg-line text-ink-2 font-semibold ring-2 ring-panel" style={{ width: size, height: size, fontSize: 10 }}>+{rest}</span>}
      {!users.length && <span className="text-ink-3 text-[12px]">—</span>}
    </div>
  );
}

export function Card({ className, children, ...p }) {
  return <div {...p} className={cx('bg-panel rounded-[20px] border border-line', className)}>{children}</div>;
}

export function Modal({ open, onClose, title, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh] bg-ink/25 anim-fade overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="bg-panel rounded-2xl shadow-2xl w-full anim-pop" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-canvas text-ink-3" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="px-5 pb-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line bg-canvas/50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>, document.body);
}

export function Drawer({ open, onClose, title, children, width = 640, actions }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20 anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="h-full bg-panel shadow-2xl flex flex-col anim-slide w-full" style={{ maxWidth: width }}>
        <div className="flex items-center gap-3 px-6 h-16 border-b border-line shrink-0">
          <div className="flex-1 min-w-0 text-[15px] font-semibold truncate">{title}</div>
          {actions}
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-canvas text-ink-3" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>, document.body);
}

export function Field({ label, children, className, hint }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-[12px] font-medium text-ink-2 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

// Поиск по списку + выбор (клавиатура: ↑ ↓ Enter, Esc — закрыть)
// items: [{ value, label, user?, color?, hint? }]; value — одно значение или массив (multi)
export function SearchList({ items, value, onPick, multi, search = true, placeholder = 'Поиск…', empty = 'Ничего не найдено', onEscape, maxHeight = 280 }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef(null);
  const ql = q.trim().toLowerCase();
  const shown = ql ? items.filter((it) => `${it.label} ${it.hint || ''}`.toLowerCase().includes(ql)) : items;
  const isOn = (v) => (multi ? (value || []).some((x) => String(x) === String(v)) : String(value ?? '') === String(v ?? ''));
  useEffect(() => { setHi(0); }, [ql]);
  useEffect(() => { listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) onPick(shown[hi].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape?.(); }
  };
  return (
    <div onKeyDown={search ? undefined : onKey}>
      {search && (
        <div className="flex items-center gap-2 h-9 px-2.5 mb-1 rounded-lg bg-canvas border border-line">
          <Search size={14} className="text-ink-3 shrink-0" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-ink-3" />
          {q && <button type="button" onClick={() => setQ('')} className="text-ink-3 hover:text-ink"><X size={13} /></button>}
        </div>
      )}
      <div ref={listRef} className="overflow-y-auto" style={{ maxHeight }}>
        {shown.map((it, i) => (
          <button type="button" key={String(it.value ?? '__none')} onMouseEnter={() => setHi(i)} onClick={() => onPick(it.value)}
            className={cx('w-full flex items-center gap-2 px-2.5 min-h-8 py-1 rounded-lg text-[13px] text-left', i === hi ? 'bg-canvas text-ink' : 'text-ink-2', it.muted && 'text-ink-3')}>
            {it.user && <Avatar user={it.user} size={20} ring={false} />}
            {it.color && <span className="size-2.5 rounded-full shrink-0" style={{ background: it.color }} />}
            <span className="flex-1 min-w-0 truncate">{it.label}{it.hint && <span className="text-ink-3"> · {it.hint}</span>}</span>
            {isOn(it.value) && <Check size={15} className="text-violet shrink-0" />}
          </button>
        ))}
        {!shown.length && <div className="px-2.5 py-3 text-[12.5px] text-ink-3 text-center">{empty}</div>}
      </div>
    </div>
  );
}

// Выпадающая панель в портале под элементом (не обрезается модалками и таблицами)
function useFloating(open, anchorRef, panelRef, onClose, minWidth = 220) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const h = panelRef.current?.offsetHeight || 320;
      const below = window.innerHeight - r.bottom;
      const up = below < h + 12 && r.top > below;
      const width = Math.max(r.width, minWidth);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPos(up ? { left, width, bottom: window.innerHeight - r.top + 6 } : { left, width, top: r.bottom + 6 });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchorRef, panelRef, minWidth]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!anchorRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, anchorRef, panelRef, onClose]);
  return pos;
}

function FloatingPanel({ open, anchorRef, onClose, minWidth, children }) {
  const panelRef = useRef(null);
  const pos = useFloating(open, anchorRef, panelRef, onClose, minWidth);
  if (!open) return null;
  return createPortal(
    <div ref={panelRef} className="fixed z-[70] bg-panel border border-line rounded-xl shadow-xl p-1.5 anim-pop"
      style={pos ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom } : { opacity: 0, left: 0, top: 0 }}>
      {children}
    </div>, document.body);
}

// Выпадающий список. Для длинных списков (или search) — с поиском.
// Возвращает значение строкой, как обычный <select>; пустое — null.
export function Select({ value, onChange, options, placeholder, className, disabled, search, renderValue }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const items = [...(placeholder !== undefined ? [{ value: null, label: placeholder === '—' ? 'Не выбрано' : placeholder, muted: true }] : []), ...options];
  const cur = options.find((o) => String(o.value) === String(value ?? ''));
  const withSearch = search ?? options.length > 8;
  return (
    <>
      <button type="button" ref={ref} disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={cx('input flex items-center gap-2 text-left disabled:opacity-60 disabled:cursor-not-allowed', open && 'border-violet/60 ring-3 ring-violet/10', className)}>
        {cur?.user && <Avatar user={cur.user} size={20} ring={false} />}
        {cur?.color && <span className="size-2.5 rounded-full shrink-0" style={{ background: cur.color }} />}
        <span className={cx('flex-1 min-w-0 truncate', !cur && 'text-ink-3')}>{cur ? (renderValue ? renderValue(cur) : cur.label) : (placeholder ?? '—')}</span>
        <ChevronDown size={15} className={cx('text-ink-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <FloatingPanel open={open} anchorRef={ref} onClose={close}>
        <SearchList items={items} value={value} search={withSearch} onEscape={close}
          onPick={(v) => { onChange(v === null || v === undefined || v === '' ? null : String(v)); close(); }} />
      </FloatingPanel>
    </>
  );
}

// Готовые списки сущностей для Select / SearchList
export const userOptions = (users, { all = false } = {}) => users.filter((u) => all || u.active).map((u) => ({ value: u.id, label: u.name, user: u }));
export const nameOptions = (list) => list.map((x) => ({ value: x.id, label: x.name }));

// Выпадающее меню / поповер, привязанный к кнопке
export function Popover({ trigger, children, align = 'left', width = 220 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx('absolute z-30 mt-2 bg-panel border border-line rounded-xl shadow-xl p-1.5 anim-pop', align === 'right' ? 'right-0' : 'left-0')} style={{ width }}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, checked, icon: Icon, danger }) {
  return (
    <button onClick={onClick} className={cx('w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-[13px] text-left hover:bg-canvas', danger ? 'text-red-600' : 'text-ink-2')}>
      {Icon && <Icon size={15} />}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Check size={15} className="text-violet" />}
    </button>
  );
}

// Мультиселект пользователей (участники, соисполнители, наблюдатели) — с поиском
export function UserPicker({ users, value = [], onChange, placeholder = 'Выберите участников', exclude = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const chosen = users.filter((u) => value.includes(u.id));
  return (
    <>
      <button type="button" ref={ref} onClick={() => setOpen((o) => !o)}
        className={cx('input flex items-center justify-between gap-2', open && 'border-violet/60 ring-3 ring-violet/10')}>
        {chosen.length ? (
          <span className="flex items-center gap-2 min-w-0">
            <AvatarStack users={chosen} max={5} size={22} />
            <span className="truncate text-ink-2">{chosen.length === 1 ? chosen[0].name : `${chosen.length} чел.`}</span>
          </span>
        ) : <span className="text-ink-3">{placeholder}</span>}
        <ChevronDown size={15} className={cx('text-ink-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <FloatingPanel open={open} anchorRef={ref} onClose={close} minWidth={260}>
        <SearchList multi value={value} items={userOptions(users).filter((o) => !exclude.includes(o.value))} placeholder="Поиск сотрудника…" onEscape={close}
          onPick={(id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])} />
      </FloatingPanel>
    </>
  );
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {Icon && <div className="size-12 rounded-2xl bg-canvas border border-line flex items-center justify-center text-ink-3 mb-3"><Icon size={22} /></div>}
      <div className="font-semibold text-[14px]">{title}</div>
      {text && <div className="text-ink-3 text-[13px] mt-1 max-w-sm">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="flex justify-center py-16"><div className="size-6 rounded-full border-2 border-line border-t-violet animate-spin" /></div>;
}

// Индикатор, который плавно «переезжает» к активному элементу (для вкладок и сегментов)
function useSlider(value, deps = []) {
  const wrap = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector('[data-active="true"]');
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ...deps]);
  useEffect(() => {
    const on = () => { const el = wrap.current?.querySelector('[data-active="true"]'); if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight }); };
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, []);
  return [wrap, box];
}

export function Tabs({ tabs, value, onChange }) {
  const [wrap, box] = useSlider(value, [tabs.length]);
  return (
    <div ref={wrap} className="relative flex items-center gap-1 border-b border-line overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.value} data-active={value === t.value} onClick={() => onChange(t.value)}
          className={cx('relative flex items-center gap-1.5 px-2.5 h-10 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}>
          {t.icon && <t.icon size={15} />}
          {t.label}
          {t.count != null && <span className="text-[11px] text-ink-3 bg-canvas rounded-full px-1.5">{t.count}</span>}
        </button>
      ))}
      {box && <span className="absolute -bottom-px h-0.5 rounded-full bg-violet transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ left: box.left + 4, width: box.width - 8 }} />}
    </div>
  );
}

// Сегментированный переключатель с «бегущей» плашкой. items: [{ value, label, count?, tone? }]
export function Segmented({ items, value, onChange, size = 'md', className }) {
  const [wrap, box] = useSlider(value, [items.length, items.map((i) => i.count).join()]);
  const active = items.find((i) => i.value === value);
  return (
    <div ref={wrap} className={cx('relative flex items-center gap-0.5 p-1 rounded-full border border-line bg-panel max-w-full overflow-x-auto', className)}>
      {box && <span className={cx('absolute rounded-full transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)]', active?.tone === 'red' ? 'bg-red-600' : 'bg-violet')}
        style={{ left: box.left, width: box.width, top: box.top, height: box.height }} />}
      {items.map((i) => (
        <button key={i.value} data-active={value === i.value} onClick={() => onChange(i.value)}
          className={cx('relative z-[1] flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap shrink-0 transition-colors duration-300',
            size === 'sm' ? 'px-3 h-7 text-[12px]' : 'px-3.5 h-8 text-[12.5px]',
            value === i.value ? 'text-white' : i.tone === 'red' && i.count ? 'text-red-600' : 'text-ink-2 hover:text-ink')}>
          {i.icon && <i.icon size={14} />}{i.label}
          {i.count != null && <span className={cx('text-[11px] tabular', value === i.value ? 'opacity-70' : 'text-ink-3')}>{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Числа «набегают» от 0 до значения. Понимает строки вида «136 ч», «1,6 млн ₽», «42%»
export function CountUp({ value, duration = 900 }) {
  const str = String(value ?? '');
  const m = /^(-?[\d\s ]*[\d](?:[.,]\d+)?)(.*)$/.exec(str);
  const target = m ? parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.')) : NaN;
  const decimals = m && /[.,](\d+)/.exec(m[1]) ? /[.,](\d+)/.exec(m[1])[1].length : 0;
  const [cur, setCur] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    let raf; const t0 = performance.now(); const from = 0;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setCur(from + (target - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  if (!Number.isFinite(target)) return str;
  const shown = cur.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <>{shown}{m[2]}</>;
}

// Цифры прокручиваются барабаном (таймер): «01:24:09»
export function Odometer({ value, className }) {
  return (
    <span className={cx('odo', className)} aria-label={value}>
      {String(value).split('').map((ch, i) => (/\d/.test(ch) ? (
        <span key={i} className="odo-digit" aria-hidden>
          <span className="odo-reel" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
            {'0123456789'.split('').map((d) => <span key={d}>{d}</span>)}
          </span>
        </span>
      ) : <span key={i} className="odo-sep" aria-hidden>{ch}</span>))}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, icons }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em]"><span className="reveal"><span>{title}</span></span></h1>
          {icons}
        </div>
        {subtitle && <p className="text-ink-2 text-[14px] mt-1 reveal-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 reveal-sub">{actions}</div>}
    </div>
  );
}

// Карточка-показатель. featured — тёмно-зелёная (главная), to — ссылка (стрелка в круге)
export function Stat({ label, value, sub, icon: Icon, featured, to, tone }) {
  const body = (
    <div className={cx('group relative h-full rounded-[22px] p-5 overflow-hidden lift',
      featured ? 'forest-solid text-white shadow-[0_18px_36px_-20px_rgba(14,47,32,.8)]' : 'bg-panel border border-line')}>
      <div className="flex items-start justify-between gap-3">
        <span className={cx('text-[14px] font-semibold', featured ? 'text-white' : 'text-ink')}>{label}</span>
        <span className={cx('arrow-btn size-9 shrink-0 rounded-full flex items-center justify-center',
          featured ? 'bg-white text-forest' : 'border border-ink/70 text-ink')}>
          {to ? <ArrowUpRight size={17} /> : Icon ? <Icon size={16} /> : <ArrowUpRight size={17} />}
        </span>
      </div>
      <div className={cx('text-[40px] leading-none font-bold tracking-[-0.03em] mt-5 tabular', tone === 'red' && !featured && 'text-red-600')}><CountUp value={value} /></div>
      {sub && <div className={cx('text-[12px] mt-3', featured ? 'text-white/75' : 'text-ink-3')}>{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

export function ConfirmButton({ onConfirm, children = 'Удалить', ...p }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <Button variant="danger" size="sm" {...p} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? 'Точно удалить?' : children}</Button>;
}
