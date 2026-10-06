import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, Play, Pencil, Calendar, User, Clock, FolderOpen, Send, Trash2, MessageSquare, Paperclip, FileText, Download, Check } from 'lucide-react';
import { useApp } from '../lib/store';
import { api, fileUrl, fmtSize } from '../lib/api';
import { TASK_STATUS } from '../lib/constants';
import { fmtDate, fmtDateTime, fmtHM, fmtTime, todayStr, toDateStr, parseDate } from '../lib/format';
import { Modal, Drawer, Field, Select, Button, ConfirmButton, Spinner, Avatar, cx } from './ui';

export const isOverdue = (t) => t.status !== 'done' && t.due_date && t.due_date < todayStr();

// Иконка статуса задачи: клик переключает «открыта → в работе → закрыта → открыта»
const NEXT = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
export function TaskStatusButton({ task, onChange, size = 18 }) {
  const Icon = task.status === 'done' ? CheckCircle2 : task.status === 'in_progress' ? CircleDot : Circle;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(NEXT[task.status]); }}
      title={`${TASK_STATUS[task.status].label} → ${TASK_STATUS[NEXT[task.status]].label}`} className="shrink-0">
      <Icon size={size} className={task.status === 'done' ? 'text-emerald-500' : task.status === 'in_progress' ? 'text-amber-500' : 'text-ink-3 hover:text-ink-2'} />
    </button>
  );
}

export function TaskStatusPill({ status }) {
  const s = TASK_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[12px] font-medium bg-canvas border border-line text-ink-2 whitespace-nowrap">
      <span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  );
}

/* ---------- Создание / редактирование задачи ---------- */
export function TaskFormModal({ open, onClose, task, projectId, onSaved }) {
  const { users, projects, toast, bump } = useApp();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(task ? { ...task } : { project_id: projectId || null, title: '', description: '', status: 'todo', assignee_id: null, due_date: null });
  }, [open, task, projectId]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const submit = async (e) => {
    e?.preventDefault();
    const err = {};
    if (!f.project_id) err.project_id = 'Выберите проект';
    if (!f.title?.trim()) err.title = 'Укажите название задачи';
    if (!f.description?.trim()) err.description = 'Опишите, что нужно сделать';
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      const body = { project_id: +f.project_id, title: f.title.trim(), description: f.description.trim(), status: f.status,
        assignee_id: f.assignee_id ? +f.assignee_id : null, due_date: f.due_date || null };
      const saved = task ? await api.put(`/tasks/${task.id}`, body) : await api.post('/tasks', body);
      toast(task ? 'Задача сохранена' : 'Задача создана');
      bump(); onSaved?.(saved); onClose();
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };

  const err = (k) => errors[k] && <span className="block text-[11.5px] text-red-600 mt-1">{errors[k]}</span>;
  return (
    <Modal open={open} onClose={onClose} title={task ? 'Редактировать задачу' : 'Новая задача'} width={560}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={busy}>{task ? 'Сохранить' : 'Создать задачу'}</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Проект (организация)">
          <Select value={f.project_id} onChange={set('project_id')} placeholder="Выберите проект"
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          {err('project_id')}
        </Field>
        <Field label="Название задачи">
          <input className={cx('input', errors.title && 'border-red-400')} value={f.title || ''} onChange={set('title')} autoFocus placeholder="Кратко: что сделать" />
          {err('title')}
        </Field>
        <Field label="Описание">
          <textarea className={cx('input', errors.description && 'border-red-400')} rows={5} value={f.description || ''} onChange={set('description')}
            placeholder="Подробности: где, что случилось, что ожидается в результате" />
          {err('description')}
        </Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Исполнитель">
            <Select value={f.assignee_id} onChange={set('assignee_id')} placeholder="Не назначен" options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))} />
          </Field>
          <Field label="Срок">
            <input type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Карточка задачи: слева детали, справа обсуждение ---------- */
export function TaskDrawer({ id, onClose }) {
  const { users, toast, bump, startTimer, version } = useApp();
  const [t, setT] = useState(null);
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    if (!id) { setT(null); return; }
    api.get(`/tasks/${id}`).then(setT).catch((e) => { toast(e.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);
  if (!id) return null;

  const patch = async (body) => {
    setT((x) => ({ ...x, ...body }));
    try { setT(await api.put(`/tasks/${id}`, body)); bump(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => { await api.del(`/tasks/${id}`); toast('Задача удалена'); bump(); onClose(); };

  return (
    <Drawer open={!!id} onClose={onClose} width={1120} title={t ? t.title : 'Задача'}
      actions={t && <>
        <Button size="sm" icon={Play} onClick={() => startTimer({ project_id: t.project_id, task_id: t.id, description: t.title })}>Таймер</Button>
        <Button size="sm" icon={Pencil} onClick={() => setEdit(true)}>Изменить</Button>
      </>}>
      {!t ? <Spinner /> : (
        <div className="lg:h-full lg:grid lg:grid-cols-[400px_1fr]">
          {/* Детали */}
          <div className="lg:overflow-y-auto lg:border-r border-line p-6 space-y-5">
            <div className="flex items-center gap-2 text-[13px] text-ink-2"><FolderOpen size={15} className="text-ink-3" />{t.project_name}</div>
            <div className="flex p-1 bg-canvas rounded-full border border-line w-fit">
              {Object.entries(TASK_STATUS).map(([k, st]) => (
                <button key={k} onClick={() => k !== t.status && patch({ status: k })}
                  className={cx('flex items-center gap-1.5 px-3 h-8 rounded-full text-[13px] font-medium transition-colors', t.status === k ? 'bg-panel shadow-sm text-ink' : 'text-ink-3 hover:text-ink-2')}>
                  <span className="size-2 rounded-full" style={{ background: st.color }} />{st.label}
                </button>
              ))}
            </div>
            <div>
              <div className="text-[12px] font-medium text-ink-3 mb-1.5">Описание</div>
              <div className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap bg-canvas/60 border border-line rounded-xl p-4">
                {t.description || <span className="text-ink-3">Без описания</span>}
              </div>
            </div>
            <Field label="Исполнитель">
              <Select value={t.assignee_id} onChange={(v) => patch({ assignee_id: v ? +v : null })} placeholder="Не назначен"
                options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))} />
            </Field>
            <Field label="Срок">
              <input type="date" className={cx('input', isOverdue(t) && 'text-red-600 border-red-300')} value={t.due_date || ''} onChange={(e) => patch({ due_date: e.target.value || null })} />
            </Field>
            <div className="space-y-2 text-[12.5px] text-ink-2">
              <div className="flex items-center gap-2"><User size={14} className="text-ink-3" />Создал: {t.creator_name || '—'}</div>
              <div className="flex items-center gap-2"><Calendar size={14} className="text-ink-3" />Создана: {fmtDateTime(t.created_at)}</div>
              <div className="flex items-center gap-2"><Clock size={14} className="text-ink-3" />Затрачено: {fmtHM(t.tracked_sec)} ч</div>
              {t.completed_at && <div className="flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-500" />Закрыта: {fmtDateTime(t.completed_at)}</div>}
            </div>
            <TaskFiles taskId={t.id} />
            <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить задачу</ConfirmButton></div>
          </div>
          {/* Обсуждение */}
          <div className="h-[75vh] lg:h-full min-h-0"><TaskChat taskId={t.id} /></div>
        </div>
      )}
      <TaskFormModal open={edit} task={t} onClose={() => setEdit(false)} onSaved={setT} />
    </Drawer>
  );
}

function TaskFiles({ taskId }) {
  const { version } = useApp();
  const [files, setFiles] = useState([]);
  useEffect(() => { api.get(`/tasks/${taskId}/files`).then(setFiles).catch(() => {}); }, [taskId, version]);
  if (!files.length) return null;
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-3 mb-1.5">Файлы · {files.length}</div>
      <div className="border border-line rounded-xl divide-y divide-line">
        {files.map((f) => (
          <a key={f.id} href={fileUrl(f.id)} className="flex items-center gap-2.5 px-3 py-2 hover:bg-canvas text-[13px]">
            <FileText size={16} className="text-violet shrink-0" />
            <span className="flex-1 min-w-0 truncate">{f.name}</span>
            <span className="text-[11.5px] text-ink-3 shrink-0">{fmtSize(f.size)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---------- Обсуждение задачи (чат в стиле мессенджера) ---------- */
const POLL_MS = 8000;
const CHAT_BG = {
  backgroundColor: '#dfe6ef',
  backgroundImage: "radial-gradient(rgba(255,255,255,.55) 1.2px, transparent 1.3px), radial-gradient(rgba(109,94,246,.08) 1px, transparent 1.1px)",
  backgroundSize: '22px 22px, 34px 34px',
  backgroundPosition: '0 0, 11px 17px',
};
function dayLabel(d) {
  const key = toDateStr(d);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (key === toDateStr(today)) return 'Сегодня';
  if (key === toDateStr(yest)) return 'Вчера';
  const wd = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][d.getDay()];
  return `${wd}, ${fmtDate(d)}`;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Подсветка @упоминаний известных пользователей
function MessageText({ text, users }) {
  const re = useMemo(() => {
    const names = users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
    return names.length ? new RegExp(`@(${names.join('|')})`, 'g') : null;
  }, [users]);
  if (!re || !text) return text;
  const out = []; let last = 0; let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className="text-[#2f6fd1] font-medium border-b border-dotted border-[#2f6fd1]/60">{m[1]}</span>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function FileCard({ c, mine, onLoad }) {
  const isImg = /^image\/(png|jpe?g|gif|webp)$/.test(c.file_mime || '');
  if (isImg) {
    return (
      <a href={fileUrl(c.file_id)} title={`${c.file_name} — скачать`} className="block">
        <img src={fileUrl(c.file_id, true)} alt={c.file_name} className="max-w-[280px] max-h-[280px] rounded-xl object-cover" onLoad={onLoad} />
      </a>
    );
  }
  return (
    <a href={fileUrl(c.file_id)} className={cx('group/file flex items-center gap-3 pl-3 pr-2 py-1.5 border-l-[3px] rounded-r-lg', mine ? 'border-[#4fae3d]' : 'border-[#3aa0e8]')}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">Файл</div>
        <div className="text-[13.5px] text-ink truncate max-w-[260px]">{c.file_name}</div>
        <div className="text-[11.5px] text-ink-3">{fmtSize(c.file_size || 0)}</div>
      </div>
      <Download size={16} className="text-ink-3 group-hover/file:text-ink shrink-0" />
    </a>
  );
}

export function TaskChat({ taskId }) {
  const { user, users, isManager, toast, bump, version } = useApp();
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [mention, setMention] = useState(null); // { query, start, index }
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const stick = useRef(true);

  // serverLast — последний id, полученный ИМЕННО с сервера (свои отправленные сообщения его не двигают,
  // иначе можно пропустить сообщения коллег, пришедшие между опросами)
  const serverLast = useRef(0);
  const load = useCallback(async (full = false) => {
    const after = full ? 0 : serverLast.current;
    const fresh = await api.get(`/tasks/${taskId}/comments${after ? `?after=${after}` : ''}`);
    if (fresh.length) serverLast.current = Math.max(serverLast.current, fresh[fresh.length - 1].id);
    setItems((cur) => {
      if (full || !cur) return fresh;
      if (!fresh.length) return cur;
      const ids = new Set(cur.map((c) => c.id));
      return [...cur, ...fresh.filter((f) => !ids.has(f.id))].sort((a, b) => a.id - b.id);
    });
  }, [taskId]);

  useEffect(() => { setItems(null); serverLast.current = 0; stick.current = true; load(true).catch(() => setItems([])); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (items) load().catch(() => {}); }, [version]);
  useLayoutEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items]);

  const append = (c) => { stick.current = true; setItems((cur) => (cur?.some((x) => x.id === c.id) ? cur : [...(cur || []), c].sort((a, b) => a.id - b.id))); };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      append(await api.post(`/tasks/${taskId}/comments`, { body }));
      setText(''); setMention(null);
      if (inputRef.current) inputRef.current.style.height = 'auto';
      inputRef.current?.focus();
      bump();
    } catch (e) { toast(e.message, 'error'); } finally { setSending(false); }
  };

  const uploadFiles = async (list) => {
    const files = [...(list || [])];
    if (!files.length) return;
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`«${f.name}» больше 25 МБ`, 'error'); continue; }
      setUploading((n) => n + 1);
      try { append(await api.upload(`/tasks/${taskId}/files`, f)); } catch (e) { toast(e.message, 'error'); } finally { setUploading((n) => n - 1); }
    }
    bump();
  };

  const del = async (id) => {
    try { await api.del(`/task-comments/${id}`); setItems((cur) => cur.filter((c) => c.id !== id)); bump(); }
    catch (e) { toast(e.message, 'error'); }
  };

  // @упоминания: ищем «@слово» перед курсором
  const activeUsers = users.filter((u) => u.active);
  const candidates = mention ? activeUsers.filter((u) => u.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];
  const onChange = (e) => {
    const v = e.target.value; setText(v);
    const caret = e.target.selectionStart;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
    e.target.style.height = 'auto'; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
  };
  const pickMention = (u) => {
    const caret = inputRef.current.selectionStart;
    const v = `${text.slice(0, mention.start)}@${u.name} ${text.slice(caret)}`;
    setText(v); setMention(null);
    requestAnimationFrame(() => { const pos = mention.start + u.name.length + 2; inputRef.current.focus(); inputRef.current.setSelectionRange(pos, pos); });
  };
  const onKeyDown = (e) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % candidates.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + candidates.length) % candidates.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(candidates[mention.index] || candidates[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const count = items ? items.filter((c) => c.kind === 'text').length : 0;
  let prevDay = null; let prev = null;

  return (
    <div className="h-full flex flex-col relative"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}>
      <div className="flex items-center gap-2 px-5 h-12 border-b border-line bg-panel shrink-0">
        <MessageSquare size={16} className="text-ink-2" />
        <h3 className="text-[14px] font-semibold">Обсуждение</h3>
        {count > 0 && <span className="text-[12px] text-ink-3">{count}</span>}
        <span className="ml-auto text-[11.5px] text-ink-3 hidden sm:block">@ — упомянуть · файлы можно перетащить сюда</span>
      </div>

      <div ref={listRef} style={CHAT_BG}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
        {items === null ? <Spinner /> : items.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="bg-white/70 rounded-2xl px-5 py-4 text-center text-[13px] text-ink-2 max-w-xs">Сообщений пока нет.<br />Напишите первым — коллеги увидят его здесь.</div>
          </div>
        ) : items.map((c) => {
          const d = parseDate(c.created_at);
          const day = toDateStr(d);
          const showDay = day !== prevDay;
          const grouped = !showDay && prev && prev.kind === 'text' && c.kind === 'text' && prev.user_id === c.user_id && d - parseDate(prev.created_at) < 5 * 60e3;
          prevDay = day; prev = c;
          const mine = c.user_id === user.id;
          return (
            <div key={c.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[12.5px] font-medium text-white bg-[#6f8aa8]/70 backdrop-blur rounded-full px-3 py-1">{dayLabel(d)}</span>
                </div>
              )}
              {c.kind === 'system' ? (
                <div className="my-1.5 ml-10 w-fit max-w-[85%] bg-white/55 backdrop-blur-sm rounded-2xl px-3.5 py-2 text-[13.5px] text-ink">
                  <span className="text-[#2f6fd1] font-medium border-b border-dotted border-[#2f6fd1]/60">{c.user_name || 'Система'}</span> {c.body}
                  <span className="ml-3 text-[11px] text-ink-3 align-bottom">{fmtTime(d)}</span>
                </div>
              ) : (
                <div className={cx('group flex items-end gap-2', mine ? 'justify-end' : '', grouped ? 'mt-0.5' : 'mt-2')}>
                  {!mine && <div className="w-8 shrink-0">{!grouped ? <Avatar user={{ name: c.user_name || '?', color: c.user_color }} size={32} ring={false} /> : null}</div>}
                  {mine && (
                    <button onClick={() => del(c.id)} title="Удалить сообщение" className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-ink-3 hover:text-red-600 hover:bg-white/70 self-center"><Trash2 size={13} /></button>
                  )}
                  <div title={fmtDateTime(c.created_at)}
                    className={cx('relative max-w-[78%] px-3 pt-1.5 pb-1 shadow-[0_1px_1px_rgba(0,0,0,.08)]',
                      mine ? 'bg-[#e6f7d2] rounded-2xl rounded-br-md' : 'bg-white rounded-2xl rounded-bl-md')}>
                    {!mine && !grouped && <div className="text-[13px] font-semibold mb-0.5" style={{ color: c.user_color || '#2f6fd1' }}>{c.user_name}</div>}
                    {c.file_id && <div className="my-1"><FileCard c={c} mine={mine} onLoad={() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }} /></div>}
                    {c.body && (
                      <div className="text-[14.5px] leading-snug text-ink whitespace-pre-wrap break-words">
                        <MessageText text={c.body} users={users} />
                        <span className="inline-block w-[58px]" />
                      </div>
                    )}
                    <div className={cx('flex items-center gap-1 text-[11px]', c.body ? 'absolute right-2.5 bottom-1' : 'justify-end mt-0.5', mine ? 'text-[#5e9c4a]' : 'text-ink-3')}>
                      {fmtTime(d)}{mine && <Check size={13} strokeWidth={2.5} />}
                    </div>
                  </div>
                  {!mine && isManager && (
                    <button onClick={() => del(c.id)} title="Удалить сообщение" className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-ink-3 hover:text-red-600 hover:bg-white/70 self-center"><Trash2 size={13} /></button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {uploading > 0 && <div className="flex justify-end mt-2"><span className="text-[12px] bg-white/70 rounded-full px-3 py-1 text-ink-2">Загрузка файла…</span></div>}
      </div>

      {/* Ввод */}
      <div className="relative shrink-0 border-t border-line bg-panel p-2.5">
        {mention && candidates.length > 0 && (
          <div className="absolute bottom-full left-3 mb-2 w-80 bg-panel border border-line rounded-xl shadow-xl p-1 anim-pop z-10">
            <div className="px-2 py-1 text-[11px] text-ink-3">Упомянуть</div>
            {candidates.map((u, i) => (
              <button key={u.id} onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}
                className={cx('w-full flex items-center gap-2 px-2 h-9 rounded-lg text-[13px] text-left', i === mention.index ? 'bg-canvas' : '')}>
                <Avatar user={u} size={22} ring={false} /><span className="whitespace-nowrap">{u.name}</span><span className="ml-auto text-[11px] text-ink-3 truncate min-w-0">{u.position}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} title="Прикрепить файл (до 25 МБ)"
            className="size-9 shrink-0 rounded-full text-ink-3 hover:text-ink hover:bg-canvas flex items-center justify-center"><Paperclip size={18} /></button>
          <textarea ref={inputRef} value={text} rows={1} onChange={onChange} onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            placeholder="Написать сообщение…" title="Enter — отправить, Shift+Enter — новая строка, @ — упомянуть"
            className="flex-1 resize-none outline-none text-[14px] bg-transparent px-1 py-2 max-h-40 placeholder:text-ink-3" style={{ minHeight: 38 }} />
          <button onClick={send} disabled={!text.trim() || sending} title="Отправить"
            className="size-9 shrink-0 rounded-full bg-violet text-white flex items-center justify-center disabled:opacity-40 hover:bg-violet/90"><Send size={16} /></button>
        </div>
      </div>

      {drag && (
        <div className="absolute inset-0 z-20 bg-violet/10 border-2 border-dashed border-violet rounded-none flex items-center justify-center pointer-events-none">
          <div className="bg-panel rounded-2xl px-5 py-3 text-[14px] font-medium shadow-lg flex items-center gap-2"><Paperclip size={18} className="text-violet" />Отпустите, чтобы прикрепить</div>
        </div>
      )}
    </div>
  );
}
