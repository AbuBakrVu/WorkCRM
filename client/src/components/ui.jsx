import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, Check } from 'lucide-react';
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
  return <div {...p} className={cx('bg-panel rounded-2xl border border-line', className)}>{children}</div>;
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

export function Select({ value, onChange, options, placeholder, className, ...p }) {
  return (
    <select {...p} className={cx('input', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

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

// Мультиселект пользователей (для участников проекта)
export function UserPicker({ users, value = [], onChange }) {
  return (
    <Popover width={260} trigger={({ toggle }) => (
      <button type="button" onClick={toggle} className="input flex items-center justify-between gap-2">
        {value.length ? <AvatarStack users={users.filter((u) => value.includes(u.id))} max={6} size={22} /> : <span className="text-ink-3">Выберите участников</span>}
        <ChevronDown size={15} className="text-ink-3" />
      </button>
    )}>
      <div className="max-h-64 overflow-y-auto">
        {users.filter((u) => u.active).map((u) => {
          const on = value.includes(u.id);
          return (
            <button type="button" key={u.id} onClick={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])}
              className="w-full flex items-center gap-2 px-2 h-9 rounded-lg hover:bg-canvas text-[13px]">
              <Avatar user={u} size={22} ring={false} />
              <span className="flex-1 text-left truncate">{u.name}</span>
              {on && <Check size={15} className="text-violet" />}
            </button>
          );
        })}
      </div>
    </Popover>
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

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex items-center gap-1 border-b border-line overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('relative flex items-center gap-1.5 px-2.5 h-10 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}>
          {t.icon && <t.icon size={15} />}
          {t.label}
          {t.count != null && <span className="text-[11px] text-ink-3 bg-canvas rounded-full px-1.5">{t.count}</span>}
          {value === t.value && <span className="absolute left-1 right-1 -bottom-px h-0.5 rounded-full bg-violet" />}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icons }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
          {icons}
        </div>
        {subtitle && <p className="text-ink-2 text-[13.5px] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = 'default' }) {
  const tones = { default: 'bg-canvas text-ink-2', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet/10 text-violet' };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-ink-2 font-medium">{label}</span>
        {Icon && <span className={cx('size-8 rounded-xl flex items-center justify-center', tones[tone])}><Icon size={16} /></span>}
      </div>
      <div className="text-[24px] font-semibold tracking-tight mt-1.5 tabular">{value}</div>
      {sub && <div className="text-[12px] text-ink-3 mt-0.5">{sub}</div>}
    </Card>
  );
}

export function ConfirmButton({ onConfirm, children = 'Удалить', ...p }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <Button variant="danger" size="sm" {...p} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? 'Точно удалить?' : children}</Button>;
}
