import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { readSheet } from 'read-excel-file/browser';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { Button, Modal, Field, Select, cx, nameOptions } from './ui';

// Поля для каждого типа импорта: key, подпись, обязательность и синонимы заголовков для автосопоставления
export const IMPORT_SPEC = {
  clients: { title: 'Импорт клиентов', fields: [
    ['name', 'Название', true, ['название', 'наименование', 'клиент', 'организация', 'компания', 'name']],
    ['inn', 'ИНН', false, ['инн', 'inn']], ['kpp', 'КПП', false, ['кпп']], ['ogrn', 'ОГРН', false, ['огрн']],
    ['contact_name', 'Контактное лицо', false, ['контакт', 'контактное лицо', 'фио']], ['phone', 'Телефон', false, ['телефон', 'тел', 'phone']],
    ['email', 'Email', false, ['email', 'e-mail', 'почта']], ['address', 'Адрес', false, ['адрес', 'юр. адрес', 'юридический адрес']],
    ['full_name', 'Полное наименование', false, ['полное наименование', 'полное название']], ['director_name', 'Руководитель', false, ['руководитель', 'директор']],
    ['bank_name', 'Банк', false, ['банк']], ['bik', 'БИК', false, ['бик']], ['account', 'Расчётный счёт', false, ['р/с', 'расчетный счет', 'расчётный счёт', 'счет']],
    ['corr_account', 'Корр. счёт', false, ['к/с', 'корр. счет', 'корреспондентский счет']], ['type', 'Тип (организация / частное лицо)', false, ['тип']], ['notes', 'Заметки', false, ['заметки', 'комментарий', 'примечание']],
  ] },
  catalog: { title: 'Импорт каталога', fields: [
    ['name', 'Наименование', true, ['наименование', 'название', 'товар', 'услуга', 'name']], ['price', 'Цена', false, ['цена', 'стоимость', 'price']],
    ['unit', 'Ед. изм.', false, ['ед', 'ед. изм.', 'единица', 'ед.изм']], ['vat_rate', 'НДС', false, ['ндс', 'ставка ндс']], ['sku', 'Артикул', false, ['артикул', 'код', 'sku']],
    ['kind', 'Тип (товар / услуга)', false, ['тип', 'вид']], ['description', 'Описание', false, ['описание']],
  ] },
  tasks: { title: 'Импорт задач', fields: [
    ['title', 'Название', true, ['название', 'задача', 'тема', 'title']], ['description', 'Описание', false, ['описание', 'подробности']],
    ['assignee', 'Исполнитель (имя или email)', false, ['исполнитель', 'ответственный']], ['due_date', 'Срок', false, ['срок', 'дедлайн', 'крайний срок', 'дата']],
    ['status', 'Статус', false, ['статус']],
  ] },
};
const low = (s) => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
const cellText = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : v == null ? '' : String(v));

function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

export function ImportModal({ kind, onClose, onDone }) {
  const spec = IMPORT_SPEC[kind];
  const { projects, toast, bump } = useApp();
  const fileRef = useRef(null);
  const [sheet, setSheet] = useState(null); // { name, header, rows }
  const [map, setMap] = useState({});
  const [projectId, setProjectId] = useState(null);
  const [upd, setUpd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = async (file) => {
    if (!file) return;
    try {
      let data;
      if (/\.csv$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf); // CSV из Excel часто в 1251
        data = parseCsv(text.replace(/^﻿/, ''));
      } else data = await readSheet(file);
      if (!data?.length) return toast('Файл пустой', 'error');
      // Заголовок — первая строка, где заполнено хотя бы 2 ячейки
      const hi = Math.max(0, data.findIndex((r) => r.filter((c) => c != null && String(c).trim()).length >= 2));
      const header = data[hi].map((h, i) => String(h ?? '').trim() || `Колонка ${i + 1}`);
      const rows = data.slice(hi + 1).filter((r) => r.some((c) => c != null && String(c).trim()));
      const auto = {};
      for (const [key, , , syn] of spec.fields) {
        const idx = header.findIndex((h) => syn.includes(low(h))) >= 0 ? header.findIndex((h) => syn.includes(low(h))) : header.findIndex((h) => syn.some((s) => low(h).startsWith(s)));
        if (idx >= 0 && !Object.values(auto).includes(idx)) auto[key] = idx;
      }
      setSheet({ name: file.name, header, rows }); setMap(auto); setResult(null);
    } catch (e) { toast(`Не удалось прочитать файл: ${e.message}`, 'error'); }
  };
  const objects = () => sheet.rows.map((r) => Object.fromEntries(Object.entries(map).filter(([, i]) => i != null).map(([k, i]) => [k, cellText(r[i]).trim()])));
  const run = async () => {
    const req = spec.fields.filter((f) => f[2] && map[f[0]] == null);
    if (req.length) return toast(`Укажите колонку для поля «${req[0][1]}»`, 'error');
    if (kind === 'tasks' && !projectId) return toast('Выберите проект', 'error');
    setBusy(true);
    try {
      const r = await api.post(`/import/${kind}`, { rows: objects(), project_id: projectId ? +projectId : undefined, update: upd });
      setResult(r); bump(); onDone?.();
      toast(`Импортировано: ${r.created}`);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const template = () => {
    const csv = '﻿' + spec.fields.map((f) => `"${f[1]}"`).join(';') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `шаблон-${kind}.csv`; a.click();
  };
  const preview = sheet ? sheet.rows.slice(0, 4) : [];
  return (
    <Modal open onClose={onClose} title={spec.title} width={760}
      footer={result ? <Button variant="primary" onClick={onClose}>Готово</Button> : <><Button onClick={onClose}>Отмена</Button>{sheet && <Button variant="primary" icon={Upload} disabled={busy} onClick={run}>Импортировать {sheet.rows.length}</Button>}</>}>
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl bg-brand/[.06] p-4"><CheckCircle2 size={22} className="text-brand" />
            <div className="text-[14px]"><b>Добавлено: {result.created}</b>{result.updated > 0 && <> · обновлено: {result.updated}</>}{result.skipped > 0 && <> · пропущено: {result.skipped}</>}</div></div>
          {result.skipped > 0 && !result.errors.length && <div className="text-[12.5px] text-ink-3">Пропущены строки, которые уже есть в CRM (совпали ИНН, название или артикул).</div>}
          {result.errors.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-[12.5px] text-amber-700 space-y-0.5"><div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} />Не загружено:</div>{result.errors.map((e) => <div key={e}>{e}</div>)}</div>}
        </div>
      ) : !sheet ? (
        <div>
          <button onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); load(e.dataTransfer.files?.[0]); }}
            className="w-full rounded-2xl border-2 border-dashed border-line-strong hover:border-brand/50 hover:bg-brand/[.03] p-10 text-center transition-colors">
            <FileSpreadsheet size={32} className="mx-auto text-brand mb-2" />
            <div className="text-[14px] font-semibold">Выберите файл Excel (.xlsx) или CSV</div>
            <div className="text-[12.5px] text-ink-3 mt-1">или перетащите сюда. Первая строка — заголовки колонок.</div>
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => load(e.target.files?.[0])} />
          <button onClick={template} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-violet hover:underline"><Download size={13} />Скачать шаблон с колонками</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px]"><FileSpreadsheet size={16} className="text-brand" /><b>{sheet.name}</b><span className="text-ink-3">· {sheet.rows.length} строк</span>
            <button onClick={() => setSheet(null)} className="ml-auto text-violet text-[12.5px] hover:underline">Другой файл</button></div>
          {kind === 'tasks' && <Field label="В какой проект"><Select value={projectId} onChange={setProjectId} placeholder="Выберите проект" search options={nameOptions(projects)} /></Field>}
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-1.5">Какая колонка файла — какое поле CRM</div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
              {spec.fields.map(([key, label, req]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={cx('w-40 shrink-0 text-[12.5px]', req ? 'text-ink font-medium' : 'text-ink-2')}>{label}{req && ' *'}</span>
                  <Select value={map[key] ?? null} onChange={(v) => setMap((m) => ({ ...m, [key]: v == null ? null : Number(v) }))} placeholder="— не загружать" search={false}
                    options={sheet.header.map((h, i) => ({ value: i, label: h }))} className="!h-8" />
                </div>
              ))}
            </div>
          </div>
          {kind !== 'tasks' && <label className="flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" checked={upd} onChange={(e) => setUpd(e.target.checked)} className="accent-[var(--color-brand)]" />Если запись уже есть — обновить её данными из файла (иначе пропустить)</label>}
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-1.5">Как загрузится (первые строки)</div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[12px]">
                <thead><tr className="bg-canvas/60">{spec.fields.filter(([k]) => map[k] != null).map(([k, l]) => <th key={k} className="text-left font-medium px-2.5 py-1.5 whitespace-nowrap">{l}</th>)}</tr></thead>
                <tbody>{preview.map((r, i) => <tr key={i} className="border-t border-line">{spec.fields.filter(([k]) => map[k] != null).map(([k]) => <td key={k} className="px-2.5 py-1.5 max-w-48 truncate">{cellText(r[map[k]])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
