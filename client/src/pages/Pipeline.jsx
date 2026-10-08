import { useEffect, useState } from 'react';
import { Plus, Calendar } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { DEAL_STAGE } from '../lib/constants';
import { fmtMoney, fmtMoneyShort, fmtDate, parseDate, plural } from '../lib/format';
import { Button, Modal, Field, Select, Avatar, ConfirmButton, PageHeader, Stat, Spinner, cx, userOptions, nameOptions } from '../components/ui';
import { Handshake, TrendingUp, Trophy } from 'lucide-react';

export default function Pipeline() {
  const { data, setData } = useLoad('/deals');
  const { toast, bump } = useApp();
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [form, setForm] = useState(null);

  if (!data) return <Spinner />;
  const move = async (id, stage) => {
    setData((d) => d.map((x) => (x.id === id ? { ...x, stage } : x)));
    try { await api.put(`/deals/${id}`, { stage }); bump(); } catch (e) { toast(e.message, 'error'); }
  };
  const open = data.filter((d) => !['won', 'lost'].includes(d.stage));
  const won = data.filter((d) => d.stage === 'won');
  const lost = data.filter((d) => d.stage === 'lost');
  const conv = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

  return (
    <div>
      <PageHeader title="Воронка сделок" subtitle="Перетаскивайте карточки между этапами"
        actions={<Button variant="primary" icon={Plus} onClick={() => setForm({})}>Новая сделка</Button>} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="В работе" value={fmtMoneyShort(open.reduce((a, d) => a + d.amount, 0))} sub={`${open.length} ${plural(open.length, 'сделка', 'сделки', 'сделок')}`} icon={Handshake} tone="violet" />
        <Stat label="Выиграно" value={fmtMoneyShort(won.reduce((a, d) => a + d.amount, 0))} sub={`${won.length} ${plural(won.length, 'сделка', 'сделки', 'сделок')}`} icon={Trophy} tone="green" />
        <Stat label="Конверсия" value={`${conv}%`} sub="выигранные из закрытых" icon={TrendingUp} />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {Object.entries(DEAL_STAGE).map(([stage, s]) => {
          const items = data.filter((d) => d.stage === stage);
          return (
            <div key={stage} onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver(null)}
              onDrop={() => { if (dragId) move(dragId, stage); setDragId(null); setOver(null); }}
              className={cx('w-[270px] shrink-0 rounded-2xl border p-2.5 transition-colors', over === stage ? 'bg-violet/5 border-violet/30' : 'bg-canvas/70 border-line')}>
              <div className="px-1.5 pb-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[13px] font-medium"><span className="size-3.5 rounded" style={{ background: s.color }} />{s.label}</span>
                  <span className="text-[12px] text-ink-3">{items.length}</span>
                </div>
                <div className="text-[12px] text-ink-3 mt-0.5 tabular">{fmtMoney(items.reduce((a, d) => a + d.amount, 0))}</div>
              </div>
              <div className="space-y-2 min-h-16">
                {items.map((d) => {
                  const late = d.expected_close && !['won', 'lost'].includes(d.stage) && parseDate(d.expected_close) < new Date(new Date().toDateString());
                  return (
                    <div key={d.id} draggable onDragStart={() => setDragId(d.id)} onClick={() => setForm(d)}
                      className={cx('bg-panel rounded-xl border border-line p-3 cursor-pointer hover:shadow-md transition-shadow', dragId === d.id && 'opacity-50')}>
                      <div className="text-[13.5px] font-medium leading-snug">{d.title}</div>
                      <div className="text-[12px] text-ink-3 truncate mt-0.5">{d.client_name || 'Без клиента'}</div>
                      <div className="flex items-center justify-between mt-2.5">
                        <span className="text-[13.5px] font-semibold tabular">{fmtMoney(d.amount)}</span>
                        <div className="flex items-center gap-2">
                          {d.expected_close && <span className={cx('inline-flex items-center gap-1 text-[11.5px]', late ? 'text-red-600' : 'text-ink-3')}><Calendar size={11} />{fmtDate(d.expected_close)}</span>}
                          <Avatar user={d.owner_name ? { name: d.owner_name, color: d.owner_color } : null} size={20} ring={false} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <DealModal deal={form} onClose={() => setForm(null)} />
    </div>
  );
}

function DealModal({ deal, onClose }) {
  const { users, clients, toast, bump, isManager } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (deal) setF({ stage: 'lead', ...deal }); }, [deal]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title?.trim()) return toast('Укажите название', 'error');
    const body = { title: f.title, client_id: f.client_id ? +f.client_id : null, amount: +f.amount || 0, stage: f.stage, owner_id: f.owner_id ? +f.owner_id : null, expected_close: f.expected_close, notes: f.notes };
    try { f.id ? await api.put(`/deals/${f.id}`, body) : await api.post('/deals', body); toast('Сохранено'); bump(); onClose(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const remove = async () => { await api.del(`/deals/${f.id}`); toast('Сделка удалена'); bump(); onClose(); };
  return (
    <Modal open={!!deal} onClose={onClose} title={f.id ? 'Сделка' : 'Новая сделка'} width={540}
      footer={<>{f.id && isManager && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Название" className="col-span-2"><input className="input" value={f.title || ''} onChange={set('title')} autoFocus /></Field>
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
        <Field label="Сумма, ₽"><input type="number" min="0" className="input" value={f.amount || ''} onChange={set('amount')} /></Field>
        <Field label="Этап"><Select value={f.stage} onChange={set('stage')} options={Object.entries(DEAL_STAGE).map(([value, s]) => ({ value, label: s.label }))} /></Field>
        <Field label="Ожидаемое закрытие"><input type="date" className="input" value={f.expected_close || ''} onChange={set('expected_close')} /></Field>
        <Field label="Ответственный" className="col-span-2"><Select value={f.owner_id} onChange={set('owner_id')} placeholder="—" search options={userOptions(users)} /></Field>
        <Field label="Заметки" className="col-span-2"><textarea className="input" rows={3} value={f.notes || ''} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}
