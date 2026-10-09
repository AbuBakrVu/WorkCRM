import { useEffect, useRef, useState } from 'react';
import { FileText, FileDown, Upload, Star, Trash2, AlertTriangle, FileCode2, Stamp, Download, Loader2 } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api, fileUrl } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Empty, Spinner, Modal, Field, Select, ConfirmButton, Pill, cx, nameOptions } from './ui';

export const DOC_KINDS = { offer: 'Коммерческое предложение', invoice: 'Счёт на оплату', act: 'Акт', upd: 'УПД (XML для ЭДО)' };
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const curPeriod = () => { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const download = (fileId) => { const a = document.createElement('a'); a.href = fileUrl(fileId); a.click(); };

/* ---------- Настройки → Шаблоны документов ---------- */
export function TemplatesSettings() {
  const { data, reload } = useLoad('/doc-templates');
  const { data: companies } = useLoad('/companies');
  const { toast } = useApp();
  const [up, setUp] = useState(null);
  if (!data) return <Spinner />;
  const setDefault = async (t) => { await api.put(`/doc-templates/${t.id}`, { is_default: true }); reload(); };
  const remove = async (t) => { await api.del(`/doc-templates/${t.id}`); reload(); toast('Шаблон удалён'); };
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[13px] text-ink-2 max-w-[560px]">Файлы Word (.docx) с метками в фигурных скобках — как в Битрикс24: <code className="text-[12px] bg-canvas px-1 rounded">{'{DocumentNumber}'}</code>, <code className="text-[12px] bg-canvas px-1 rounded">{'{ProductsProductName}'}</code>, <code className="text-[12px] bg-canvas px-1 rounded">{'{TotalSum~W=Y}'}</code>… Картинки-метки <code className="text-[12px] bg-canvas px-1 rounded">{'{MyCompanyUfStamp}'}</code>, <code className="text-[12px] bg-canvas px-1 rounded">{'{MyCompanyUfDirectorSign}'}</code> и <code className="text-[12px] bg-canvas px-1 rounded">{'{PaymentQrCode}'}</code> заменяются печатью, подписью и QR-кодом для оплаты.</p>
        <Button variant="primary" icon={Upload} onClick={() => setUp({ kind: 'invoice' })}>Загрузить шаблон</Button>
      </div>
      {!data.length ? <Card><Empty icon={FileText} title="Шаблонов пока нет" text="Загрузите свои шаблоны КП, счёта и акта из Битрикс24 — метки подойдут без переделки" /></Card> : (
        <div className="space-y-4">
          {['offer', 'invoice', 'act'].map((k) => {
            const list = data.filter((t) => t.kind === k);
            if (!list.length) return null;
            return (
              <div key={k}>
                <h3 className="text-[13px] font-semibold text-ink-2 mb-1.5">{DOC_KINDS[k]}</h3>
                <Card className="divide-y divide-line">
                  {list.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="size-9 rounded-xl bg-[#2b579a]/10 text-[#2b579a] grid place-items-center shrink-0"><FileText size={17} /></span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2"><span className="font-medium text-ink truncate">{t.name}</span>{!!t.is_default && <Pill color="var(--color-brand)" bg="color-mix(in srgb, var(--color-brand) 12%, transparent)">основной</Pill>}</div>
                        <div className="text-[12px] text-ink-3">{t.company_name ? `Для ${t.company_name}` : 'Для всех компаний'} · {t.file_name}</div>
                        {t.tags?.unknown?.length > 0 && <div className="text-[11.5px] text-amber-600 flex items-center gap-1 mt-0.5"><AlertTriangle size={12} />Неизвестные метки (будут пустыми): {t.tags.unknown.join(', ')}</div>}
                      </div>
                      {!t.is_default && <button onClick={() => setDefault(t)} title="Сделать основным" className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-3"><Star size={15} /></button>}
                      <button onClick={() => download(t.file_id)} title="Скачать шаблон" className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-3"><Download size={15} /></button>
                      <ConfirmButton size="sm" variant="ghost" onConfirm={() => remove(t)}><Trash2 size={14} /></ConfirmButton>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}
      {up && <UploadTemplate init={up} companies={companies || []} onClose={() => setUp(null)} onDone={reload} />}
    </div>
  );
}

function UploadTemplate({ init, companies, onClose, onDone }) {
  const { toast } = useApp();
  const ref = useRef(null);
  const [f, setF] = useState({ ...init });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!file) return toast('Выберите файл .docx', 'error');
    setBusy(true);
    try {
      const res = await fetch('/api/doc-templates', { method: 'POST', credentials: 'same-origin', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Kind': f.kind, 'X-Name': encodeURIComponent(f.name || ''), 'X-Company': f.company_id || '' } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Ошибка');
      toast(d.tags?.unknown?.length ? `Загружено. Неизвестные метки: ${d.tags.unknown.join(', ')}` : 'Шаблон загружен', d.tags?.unknown?.length ? 'error' : 'ok');
      onDone(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Новый шаблон" width={520} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={busy} onClick={send}>Загрузить</Button></>}>
      <div className="space-y-3.5">
        <button onClick={() => ref.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-line-strong hover:border-brand/50 p-6 text-center">
          <FileText size={26} className="mx-auto text-[#2b579a] mb-1.5" />
          <div className="text-[13.5px] font-medium">{file ? file.name : 'Выберите файл Word (.docx)'}</div>
        </button>
        <input ref={ref} type="file" accept=".docx" hidden onChange={(e) => { const x = e.target.files?.[0]; setFile(x || null); if (x && !f.name) setF((y) => ({ ...y, name: x.name.replace(/\.docx$/i, '') })); }} />
        <Field label="Какой документ"><Select value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: v }))} options={['offer', 'invoice', 'act'].map((k) => ({ value: k, label: DOC_KINDS[k] }))} /></Field>
        <Field label="Название"><input className="input" value={f.name || ''} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Например: Счёт за период" /></Field>
        <Field label="Для какой компании" hint="Если у каждой компании свой бланк"><Select value={f.company_id} onChange={(v) => setF((x) => ({ ...x, company_id: v }))} placeholder="Для всех" options={nameOptions(companies)} /></Field>
      </div>
    </Modal>
  );
}

/* ---------- Формирование документа ---------- */
// source: { invoice_id } или { deal_id }; kinds — какие документы можно сделать
export function DocumentsPanel({ source, kinds, companyId, period: initPeriod, title = 'Документы' }) {
  const { toast } = useApp();
  const q = source.invoice_id ? `invoice_id=${source.invoice_id}` : `deal_id=${source.deal_id}`;
  const { data: docs, reload } = useLoad(`/documents?${q}`, [q]);
  const [make, setMake] = useState(null);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="text-[14px] font-semibold mr-auto">{title}</h3>
        {kinds.map((k) => (
          <Button key={k} size="sm" icon={k === 'upd' ? FileCode2 : FileDown} onClick={() => setMake(k)}>{k === 'offer' ? 'КП' : k === 'invoice' ? 'Счёт' : k === 'act' ? 'Акт' : 'УПД'}</Button>
        ))}
      </div>
      {!docs ? null : !docs.length ? <div className="text-[12.5px] text-ink-3">Документы ещё не формировались</div> : (
        <div className="border border-line rounded-xl divide-y divide-line">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 h-11 text-[13px]">
              <span className="flex-1 min-w-0 truncate"><b className="font-medium text-ink">{DOC_KINDS[d.kind].replace(' на оплату', '').replace(' (XML для ЭДО)', '')} № {d.number}</b>
                <span className="text-ink-3"> · {fmtDateTime(d.created_at)}{d.with_stamp ? ' · с печатью' : ''}{d.template_name ? ` · ${d.template_name}` : ''}</span></span>
              {d.docx_file_id && <button onClick={() => download(d.docx_file_id)} className="h-7 px-2.5 rounded-full border border-line text-[12px] font-semibold text-[#2b579a] hover:bg-canvas">Word</button>}
              {d.pdf_file_id && <button onClick={() => download(d.pdf_file_id)} className="h-7 px-2.5 rounded-full border border-line text-[12px] font-semibold text-red-600 hover:bg-canvas">PDF</button>}
              {d.xml_file_id && <button onClick={() => download(d.xml_file_id)} className="h-7 px-2.5 rounded-full border border-line text-[12px] font-semibold text-brand hover:bg-canvas">XML</button>}
            </div>
          ))}
        </div>
      )}
      {make && <MakeDocument kind={make} source={source} companyId={companyId} period={initPeriod} onClose={() => setMake(null)} onDone={(d) => { reload(); toast(`${DOC_KINDS[d.kind]} № ${d.number} готов`); }} />}
    </div>
  );
}

function MakeDocument({ kind, source, companyId, period: initPeriod, onClose, onDone }) {
  const { toast } = useApp();
  const { data: tpls } = useLoad('/doc-templates');
  const { data: companies } = useLoad('/companies');
  const [f, setF] = useState({ with_stamp: true, period: initPeriod || curPeriod(), template_id: null, number: '', date: '' });
  const [busy, setBusy] = useState(null);
  const list = (tpls || []).filter((t) => t.kind === kind && (!t.company_id || !companyId || t.company_id === +companyId));
  useEffect(() => { if (list.length && !f.template_id) setF((x) => ({ ...x, template_id: String((list.find((t) => t.is_default) || list[0]).id) })); }, [list, f.template_id]);
  const company = (companies || []).find((c) => c.id === +companyId) || (companies || [])[0];
  const hasStamp = company && (company.sign_file_id || company.stamp_file_id);
  const tpl = list.find((t) => String(t.id) === String(f.template_id));
  const usesPeriod = kind !== 'upd' && tpl?.tags?.tags?.some((t) => /^Uf|Period/.test(t));
  const go = async (format) => {
    setBusy(format);
    try {
      const d = await api.post('/documents', { kind, ...source, template_id: f.template_id ? +f.template_id : undefined, with_stamp: !!f.with_stamp && !!hasStamp,
        period: usesPeriod ? f.period : undefined, number: f.number || undefined, date: f.date || undefined, format, pdf: format === 'pdf' });
      const fileId = format === 'pdf' ? d.pdf_file_id : format === 'xml' ? d.xml_file_id : d.docx_file_id;
      if (fileId) download(fileId);
      onDone(d); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title={DOC_KINDS[kind]} width={520}
      footer={kind === 'upd'
        ? <><Button onClick={onClose}>Отмена</Button><Button variant="primary" icon={busy ? Loader2 : FileCode2} disabled={!!busy} onClick={() => go('xml')}>Скачать XML</Button></>
        : <><Button onClick={onClose}>Отмена</Button><Button icon={busy === 'docx' ? Loader2 : FileText} disabled={!!busy || !list.length} onClick={() => go('docx')}>Word</Button><Button variant="primary" icon={busy === 'pdf' ? Loader2 : FileDown} disabled={!!busy || !list.length} onClick={() => go('pdf')}>PDF</Button></>}>
      {kind === 'upd' ? (
        <div className="space-y-3 text-[13px] text-ink-2">
          <p>Файл формата ФНС 5.03 — загрузите его в свою систему ЭДО (Диадок, СБИС, Контур) и подпишите там. Если в позициях есть НДС — формируется УПД со статусом 1 (счёт-фактура + акт), без НДС — со статусом 2.</p>
          <p className="text-[12.5px] text-ink-3">Для правильной маршрутизации укажите «ID участника ЭДО» в реквизитах своей компании и клиента.</p>
          <Field label="Дата (если не сегодня)"><input type="date" className="input" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></Field>
        </div>
      ) : !tpls ? <Spinner /> : !list.length ? (
        <div className="text-[13px] text-ink-2">Нет шаблона «{DOC_KINDS[kind]}». Загрузите его: <b>Настройки → Шаблоны документов</b>.</div>
      ) : (
        <div className="space-y-3.5">
          {list.length > 1 && <Field label="Шаблон"><Select value={f.template_id} onChange={(v) => setF((x) => ({ ...x, template_id: v }))} options={list.map((t) => ({ value: t.id, label: t.name }))} /></Field>}
          {usesPeriod && <Field label="Период" hint="Подставится в строки: «Абонентское обслуживание (за октябрь 2026)»"><input className="input" value={f.period} onChange={(e) => setF((x) => ({ ...x, period: e.target.value }))} /></Field>}
          {kind !== 'invoice' && <div className="grid grid-cols-2 gap-3">
            <Field label="Номер" hint="Пусто — следующий по порядку"><input className="input" value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} placeholder="авто" /></Field>
            <Field label="Дата"><input type="date" className="input" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></Field>
          </div>}
          <label className={cx('flex items-center gap-2.5 rounded-xl border p-3 text-[13px]', hasStamp ? 'border-line cursor-pointer' : 'border-line opacity-60')}>
            <input type="checkbox" disabled={!hasStamp} checked={!!f.with_stamp && !!hasStamp} onChange={(e) => setF((x) => ({ ...x, with_stamp: e.target.checked }))} className="accent-[var(--color-brand)] size-4" />
            <Stamp size={16} className="text-brand" />
            <span>С подписью и печатью{!hasStamp && <span className="block text-[11.5px] text-ink-3">Загрузите подпись и печать: Настройки → Мои компании</span>}</span>
          </label>
        </div>
      )}
    </Modal>
  );
}
