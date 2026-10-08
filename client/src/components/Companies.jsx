import { useEffect, useRef, useState } from 'react';
import { Plus, Building, Star, ImagePlus, Trash2, Pencil } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api, fileUrl } from '../lib/api';
import { VAT_RATES } from '../lib/constants';
import { Button, Card, Empty, Spinner, Modal, Field, Select, ConfirmButton, Pill, cx } from './ui';
import { RequisitesFields } from './Requisites';

const IMAGES = [['logo', 'Логотип', 'logo_file_id'], ['sign', 'Подпись руководителя', 'sign_file_id'], ['stamp', 'Печать', 'stamp_file_id']];

// Настройки → Мои компании: от чьего имени выставляем КП, счета, УПД
export function CompaniesSettings() {
  const { data, reload } = useLoad('/companies');
  const [form, setForm] = useState(null);
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[13px] text-ink-2">Организации, от имени которых формируются КП, счета и УПД. В сделке выбирается одна из них.</p>
        <Button variant="primary" icon={Plus} onClick={() => setForm({})}>Добавить</Button>
      </div>
      {data.length === 0 ? (
        <Card><Empty icon={Building} title="Компаний пока нет" text="Добавьте свою организацию с реквизитами, подписью и печатью"
          action={<Button variant="primary" icon={Plus} onClick={() => setForm({})}>Добавить компанию</Button>} /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.map((c) => (
            <Card key={c.id} className="p-4 lift cursor-pointer" onClick={() => setForm(c)}>
              <div className="flex items-start gap-3">
                {c.logo_file_id ? <img src={fileUrl(c.logo_file_id, true)} alt="" className="size-11 rounded-xl object-contain bg-white border border-line" />
                  : <span className="size-11 rounded-xl bg-brand/10 text-brand grid place-items-center"><Building size={20} /></span>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-semibold truncate">{c.name}</span>{!!c.is_default && <Pill color="var(--color-brand)" bg="color-mix(in srgb, var(--color-brand) 12%, transparent)">по умолчанию</Pill>}</div>
                  <div className="text-[12.5px] text-ink-3 mt-0.5">{[c.inn && `ИНН ${c.inn}`, c.kpp && `КПП ${c.kpp}`].filter(Boolean).join(' · ') || 'Реквизиты не заполнены'}</div>
                  <div className="text-[12px] text-ink-3 mt-1.5 flex gap-3">
                    <span>{VAT_RATES.find((v) => v.value === c.vat_rate)?.label || 'НДС не указан'}</span>
                    <span className={c.sign_file_id ? 'text-emerald-600' : ''}>{c.sign_file_id ? '✓ подпись' : 'нет подписи'}</span>
                    <span className={c.stamp_file_id ? 'text-emerald-600' : ''}>{c.stamp_file_id ? '✓ печать' : 'нет печати'}</span>
                  </div>
                </div>
                <Pencil size={15} className="text-ink-3" />
              </div>
            </Card>
          ))}
        </div>
      )}
      <CompanyModal company={form} onClose={() => setForm(null)} onSaved={(c) => { reload(); setForm(c); }} onDone={() => { reload(); setForm(null); }} />
    </div>
  );
}

function CompanyModal({ company, onClose, onSaved, onDone }) {
  const { toast, bump } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (company) setF({ vat_rate: '22', ...company }); }, [company]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const body = () => {
    const { id, created_at, logo_file_id, sign_file_id, stamp_file_id, ...rest } = f; // eslint-disable-line no-unused-vars
    return { ...rest, is_default: !!f.is_default };
  };
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.name?.trim()) return toast('Укажите краткое название', 'error');
    try {
      const c = f.id ? await api.put(`/companies/${f.id}`, body()) : await api.post('/companies', body());
      toast('Сохранено'); bump();
      if (f.id) onDone(); else onSaved(c); // новая — остаёмся, чтобы загрузить подпись и печать
    } catch (err) { toast(err.message, 'error'); }
  };
  const remove = async () => { await api.del(`/companies/${f.id}`); toast('Компания удалена'); bump(); onDone(); };
  const setImg = (c) => setF((x) => ({ ...x, logo_file_id: c.logo_file_id, sign_file_id: c.sign_file_id, stamp_file_id: c.stamp_file_id }));
  return (
    <Modal open={!!company} onClose={onClose} title={f.id ? f.name || 'Компания' : 'Новая компания'} width={680}
      footer={<>{f.id && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}<Button onClick={onClose}>Закрыть</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Краткое название" className="col-span-2" hint="Как показывать в списках: ООО «Тредит», ИП Иванов"><input className="input" value={f.name || ''} onChange={set('name')} autoFocus /></Field>
        <Field label="НДС по умолчанию"><Select value={f.vat_rate} onChange={set('vat_rate')} options={VAT_RATES} /></Field>
        <Field label="Главный бухгалтер (ФИО)"><input className="input" value={f.accountant_name || ''} onChange={set('accountant_name')} /></Field>
        <Field label="Телефон"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Сайт" className="col-span-2"><input className="input" value={f.site || ''} onChange={set('site')} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer">
          <input type="checkbox" checked={!!f.is_default} onChange={set('is_default')} className="accent-[var(--color-brand)] size-4" />
          <Star size={14} />Компания по умолчанию для новых сделок
        </label>
        <RequisitesFields f={f} set={set} />
        <div className="col-span-2">
          <div className="text-[12px] font-medium text-ink-2 mb-1.5">Картинки для документов <span className="text-ink-3 font-normal">— PNG с прозрачным фоном</span></div>
          {f.id ? (
            <div className="grid grid-cols-3 gap-3">
              {IMAGES.map(([kind, label, col]) => <ImageSlot key={kind} companyId={f.id} kind={kind} label={label} fileId={f[col]} onChange={setImg} />)}
            </div>
          ) : <div className="text-[12.5px] text-ink-3 bg-canvas rounded-xl p-3">Сохраните компанию — после этого можно будет загрузить логотип, подпись и печать.</div>}
        </div>
      </form>
    </Modal>
  );
}

function ImageSlot({ companyId, kind, label, fileId, onChange }) {
  const { toast } = useApp();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try { onChange(await api.upload(`/companies/${companyId}/image/${kind}`, file)); toast(`${label}: загружено`); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  const remove = async () => { try { onChange(await api.del(`/companies/${companyId}/image/${kind}`)); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="rounded-xl border border-dashed border-line-strong p-2.5 text-center">
      <div className="h-20 grid place-items-center rounded-lg bg-white mb-2 overflow-hidden">
        {fileId ? <img src={fileUrl(fileId, true)} alt={label} className="max-h-20 max-w-full object-contain" /> : <ImagePlus size={22} className="text-ink-3" />}
      </div>
      <div className="text-[12px] font-medium truncate">{label}</div>
      <div className="flex justify-center gap-1 mt-1.5">
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={cx('text-[12px] text-brand hover:underline', busy && 'opacity-50')}>{fileId ? 'Заменить' : 'Загрузить'}</button>
        {fileId && <button type="button" onClick={remove} className="text-ink-3 hover:text-red-600 ml-2" title="Удалить"><Trash2 size={13} /></button>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
