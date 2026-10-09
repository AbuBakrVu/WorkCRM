import { useMemo, useState } from 'react';
import { Avatar, cx } from './ui';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Текст сообщения: «@Имя Фамилия» подсвечивается
export function MessageText({ text, users, mine }) {
  const re = useMemo(() => {
    const names = users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
    return names.length ? new RegExp(`@(${names.join('|')})`, 'gi') : null;
  }, [users]);
  if (!re || !text) return text;
  const out = []; let last = 0; let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={cx('font-semibold rounded px-0.5', mine ? 'bg-white/20' : 'text-violet bg-violet/10')}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

// Подсказка по «@» в поле ввода. Используется так:
//   const mn = useMentions(users, text, setText, inputRef);
//   <textarea onChange={mn.onChange} onKeyDown={(e) => { if (mn.onKeyDown(e)) return; … }} onBlur={mn.closeSoon} />
//   {mn.popup('absolute bottom-full left-0 mb-2')}
export function useMentions(users, text, setText, inputRef) {
  const [mention, setMention] = useState(null);
  const candidates = mention ? users.filter((u) => u.active && u.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];
  const onChange = (e) => {
    const v = e.target.value; setText(v);
    const caret = e.target.selectionStart;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
    e.target.style.height = 'auto'; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
  };
  const pick = (u) => {
    const caret = inputRef.current.selectionStart;
    setText(`${text.slice(0, mention.start)}@${u.name} ${text.slice(caret)}`);
    const pos = mention.start + u.name.length + 2;
    setMention(null);
    requestAnimationFrame(() => { inputRef.current.focus(); inputRef.current.setSelectionRange(pos, pos); });
  };
  // true — нажатие забрала подсказка (стрелки, Enter/Tab, Esc)
  const onKeyDown = (e) => {
    if (!mention || !candidates.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % candidates.length })); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + candidates.length) % candidates.length })); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates[mention.index] || candidates[0]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return true; }
    return false;
  };
  const popup = (className) => mention && candidates.length > 0 && (
    <div className={cx('w-80 bg-panel border border-line rounded-xl shadow-xl p-1.5 anim-pop z-10', className)}>
      <div className="px-2 py-1 text-[11px] font-medium text-ink-3">Упомянуть</div>
      {candidates.map((u, i) => (
        <button type="button" key={u.id} onMouseDown={(e) => { e.preventDefault(); pick(u); }}
          className={cx('w-full flex items-center gap-2 px-2 h-9 rounded-lg text-[13px] text-left', i === mention.index ? 'bg-canvas' : 'hover:bg-canvas')}>
          <Avatar user={u} size={22} ring={false} /><span className="whitespace-nowrap">{u.name}</span>
          <span className="ml-auto text-[11px] text-ink-3 truncate min-w-0">{u.position}</span>
        </button>
      ))}
    </div>
  );
  return { onChange, onKeyDown, popup, reset: () => setMention(null), closeSoon: () => setTimeout(() => setMention(null), 150) };
}
