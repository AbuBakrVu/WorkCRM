import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, X, BookOpen, Pin, KeyRound, Eye, EyeOff, Copy, Pencil, Building2, Monitor, FolderOpen } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Empty, Spinner, Drawer, Modal, Field, Select, ConfirmButton, PageHeader, cx, nameOptions } from '../components/ui';
import { HistoryPanel } from '../components/History';

// Простое оформление текста: **жирный**, `код`, ссылки, списки «- », заголовки «# »
function Rich({ text }) {
  const lines = String(text || '').split('\n');
  const inline = (s, k) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g);
    return parts.map((p, i) => p.startsWith('**') ? <b key={`${k}${i}`}>{p.slice(2, -2)}</b>
      : p.startsWith('`') ? <code key={`${k}${i}`} className="px-1 py-0.5 rounded bg-canvas border border-line text-[12.5px] font-mono">{p.slice(1, -1)}</code>
      : /^https?:\/\//.test(p) ? <a key={`${k}${i}`} href={p} target="_blank" rel="noreferrer" className="text-violet hover:underline break-all">{p}</a> : p);
  };
  return <div className="text-[14px] leading-relaxed text-ink space-y-1.5">{lines.map((l, i) => {
    if (/^#{1,3} /.test(l)) return <h3 key={i} className="text-[15px] font-semibold pt-2">{inline(l.replace(/^#+ /, ''), i)}</h3>;
    if (/^[-*•] /.test(l)) return <div key={i} className="flex gap-2 pl-1"><span className="text-ink-3">•</span><span>{inline(l.slice(2), i)}</span></div>;
    if (/^\d+[.)] /.test(l)) return <div key={i} className="flex gap-2 pl-1"><span className="text-ink-3 tabular">{l.match(/^\d+/)[0]}.</span><span>{inline(l.replace(/^\d+[.)] /, ''), i)}</span></div>;
    if (!l.trim()) return <div key={i} className="h-1" />;
    return <p key={i}>{inline(l, i)}</p>;
  })}</div>;
}

export default function Kb() {
  const { data, reload } = useLoad('/kb');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null);
  useEffect(() => { const o = Number(params.get('open')); if (o) { setOpenId(o); setParams({}, { replace: true }); } }, [params, setParams]);
  const cats = useMemo(() => [...new Set((data || []).map((k) => k.category).filter(Boolean))].sort(), [data]);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data || []).filter((k) => (!cat || k.category === cat) && (!ql || `${k.title} ${k.body || ''} ${k.client_name || ''} ${k.asset_name || ''}`.toLowerCase().includes(ql)));
  }, [data, q, cat]);
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title="База знаний" subtitle="Инструкции, схемы, доступы к оборудованию клиентов — пароли хранятся зашифрованными"
        actions={<Button variant="primary" icon={Plus} onClick={() => setForm({ category: cat })}>Новая статья</Button>} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className={cx('flex items-center gap-1.5 h-9 px-3 rounded-full border bg-panel', q ? 'border-violet/40' : 'border-line')}>
          <Search size={15} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по статьям" className="outline-none text-[13px] w-56 bg-transparent" />
          {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
        </div>
        <button className={cx('chip', !cat && 'chip-active')} onClick={() => setCat(null)}>Все</button>
        {cats.map((c) => <button key={c} className={cx('chip', cat === c && 'chip-active')} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {!list.length ? <Card><Empty icon={BookOpen} title={data.length ? 'Ничего не найдено' : 'Статей пока нет'} text="Запишите инструкции, схемы сети и доступы — чтобы любой в команде мог быстро найти" /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 stagger">
          {list.map((k) => (
            <Card key={k.id} className="p-4 lift cursor-pointer" onClick={() => setOpenId(k.id)}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">{k.pinned ? <Pin size={11} className="text-brand fill-current" /> : null}{k.category || 'Без раздела'}</div>
                  <div className="font-semibold text-ink mt-0.5 leading-snug">{k.title}</div>
                </div>
                {!!k.has_secret && <span title="Есть зашифрованные доступы" className="size-7 rounded-full bg-amber-50 text-amber-600 grid place-items-center shrink-0"><KeyRound size={14} /></span>}
              </div>
              {k.body && <div className="text-[12.5px] text-ink-3 line-clamp-2 mt-1.5">{k.body.replace(/[*#`]/g, '')}</div>}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 text-[11.5px] text-ink-3">
                {k.client_name && <span className="inline-flex items-center gap-1"><Building2 size={11} />{k.client_name}</span>}
                {k.asset_name && <span className="inline-flex items-center gap-1"><Monitor size={11} />{k.asset_name}</span>}
                {k.project_name && !k.client_name && <span className="inline-flex items-center gap-1"><FolderOpen size={11} />{k.project_name}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <KbDrawer id={openId} onClose={() => setOpenId(null)} onEdit={setForm} />
      {form && <KbModal article={form} cats={cats} onClose={() => setForm(null)} onSaved={(k) => { reload(); setOpenId(k.id); }} />}
    </div>
  );
}

function SecretBox({ id }) {
  const { toast } = useApp();
  const [val, setVal] = useState(null);
  const show = async () => { try { setVal((await api.get(`/kb/${id}/secret`)).secret || ''); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2 mb-2"><KeyRound size={15} className="text-amber-600" /><span className="text-[13px] font-semibold">Доступы</span>
        <span className="text-[11.5px] text-ink-3">хранятся зашифрованными, просмотр записывается в историю</span>
        <div className="ml-auto flex gap-1">
          {val != null && <button onClick={() => { navigator.clipboard?.writeText(val); toast('Скопировано'); }} className="size-8 grid place-items-center rounded-lg hover:bg-amber-100 text-amber-700" title="Скопировать"><Copy size={14} /></button>}
          <button onClick={() => (val == null ? show() : setVal(null))} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-amber-300 text-[12.5px] font-medium text-amber-700">{val == null ? <><Eye size={14} />Показать</> : <><EyeOff size={14} />Скрыть</>}</button>
        </div>
      </div>
      {val == null ? <div className="font-mono text-[13px] text-ink-3 tracking-widest">••••••••••••</div> : <pre className="font-mono text-[13px] whitespace-pre-wrap break-all text-ink">{val}</pre>}
    </div>
  );
}

function KbDrawer({ id, onClose, onEdit }) {
  const { toast, version, bump } = useApp();
  const [k, setK] = useState(null);
  useEffect(() => { if (id) api.get(`/kb/${id}`).then(setK).catch((e) => toast(e.message, 'error')); else setK(null); }, [id, version, toast]);
  if (!id) return null;
  const remove = async () => { await api.del(`/kb/${id}`); toast('Статья удалена в корзину'); bump(); onClose(); };
  return (
    <Drawer open onClose={onClose} width={760} title={k?.title || 'Статья'} actions={k && <Button size="sm" icon={Pencil} onClick={() => onEdit(k)}>Изменить</Button>}>
      {!k ? <Spinner /> : (
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
            {k.category && <span className="font-medium text-ink-2">{k.category}</span>}
            {k.client_name && <span className="inline-flex items-center gap-1"><Building2 size={12} />{k.client_name}</span>}
            {k.asset_name && <span className="inline-flex items-center gap-1"><Monitor size={12} />{k.asset_name}</span>}
            <span>Обновлено {fmtDateTime(k.updated_at)}{k.updated_by_name && ` · ${k.updated_by_name}`}</span>
          </div>
          {!!k.has_secret && <SecretBox id={k.id} />}
          {k.body ? <Rich text={k.body} /> : <div className="text-ink-3 text-[13px]">Текста нет</div>}
          <HistoryPanel entity="kb" id={k.id} />
          <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить статью</ConfirmButton></div>
        </div>
      )}
    </Drawer>
  );
}

function KbModal({ article, cats, onClose, onSaved }) {
  const { clients, projects, toast, bump } = useApp();
  const [assets, setAssets] = useState([]);
  const [f, setF] = useState({ ...article });
  const [secret, setSecret] = useState(null); // null — не меняем
  useEffect(() => { api.get('/assets').then(setAssets).catch(() => {}); }, []);
  useEffect(() => { if (article.id && article.has_secret) api.get(`/kb/${article.id}/secret`).then((r) => setSecret(r.secret || '')).catch(() => {}); }, [article]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const save = async () => {
    if (!f.title?.trim()) return toast('Укажите заголовок', 'error');
    const body = { title: f.title.trim(), category: f.category?.trim() || null, body: f.body || null, client_id: f.client_id ? +f.client_id : null,
      project_id: f.project_id ? +f.project_id : null, asset_id: f.asset_id ? +f.asset_id : null, pinned: !!f.pinned, ...(secret != null ? { secret } : {}) };
    try { const k = f.id ? await api.put(`/kb/${f.id}`, body) : await api.post('/kb', body); toast('Статья сохранена'); bump(); onSaved(k); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Редактировать статью' : 'Новая статья'} width={760}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Заголовок" className="col-span-2"><input className="input" value={f.title || ''} onChange={set('title')} autoFocus placeholder="Например: Доступы к роутеру в ТЦ «Гранд Парк»" /></Field>
        <Field label="Раздел"><input className="input" list="kb-cats" value={f.category || ''} onChange={set('category')} placeholder="Инструкции, Доступы, Схемы сети…" /><datalist id="kb-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="Проект"><Select value={f.project_id} onChange={set('project_id')} placeholder="—" search options={nameOptions(projects)} /></Field>
        <Field label="Устройство"><Select value={f.asset_id} onChange={set('asset_id')} placeholder="—" search options={assets.filter((a) => !f.client_id || a.client_id === +f.client_id).map((a) => ({ value: a.id, label: a.name, hint: a.client_name }))} /></Field>
        <Field label="Текст" className="col-span-2" hint="Оформление: **жирный**, `команда`, строки с «- » — список, с «# » — заголовок. Ссылки становятся кликабельными.">
          <textarea className="input font-[450]" rows={10} value={f.body || ''} onChange={set('body')} />
        </Field>
        <div className="col-span-2 rounded-2xl border border-amber-300 bg-amber-50/50 p-3.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold mb-2"><KeyRound size={15} className="text-amber-600" />Доступы (логины, пароли, ключи)
            {secret == null && article.has_secret && <span className="text-[12px] font-normal text-ink-3">загрузка…</span>}</div>
          <textarea className="input font-mono text-[12.5px]" rows={3} value={secret ?? ''} onChange={(e) => setSecret(e.target.value)} placeholder={'admin / P@ssw0rd\nWi-Fi: Office-5G / 12345678'} />
          <div className="text-[11.5px] text-ink-3 mt-1">Шифруется на сервере; в списках и поиске не виден, показывается по кнопке.</div>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={!!f.pinned} onChange={set('pinned')} className="accent-[var(--color-brand)] size-4" /><Pin size={14} />Закрепить вверху</label>
      </div>
    </Modal>
  );
}
