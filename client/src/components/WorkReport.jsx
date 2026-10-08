import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, PauseCircle, Clock } from 'lucide-react';
import { useApp, useNow, timerSeconds } from '../lib/store';
import { fmtHMS } from '../lib/format';
import { Modal, Button, Odometer, cx } from './ui';

// Окно отчёта при «Приостановить» / «Закрыть задачу». Открывается через askWork(task, action) из любого места
export function WorkReportModal() {
  const { work, setWork, finishWork, timer, toast } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  const now = useNow();
  useEffect(() => { if (work) { setNote(''); setErr(''); setTimeout(() => ref.current?.focus(), 50); } }, [work]);
  if (!work) return null;

  const close = work.action === 'close';
  const timerHere = timer && timer.task_id === work.task.id;
  const sec = timerHere ? timerSeconds(timer, now) : 0;

  const submit = async () => {
    if (!note.trim()) { setErr(close ? 'Напишите, с каким итогом закрыта задача' : 'Напишите, что сделано за это время'); return; }
    setBusy(true);
    try { await finishWork(work.task.id, work.action, note.trim()); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={() => !busy && setWork(null)} width={540}
      title={<span className="flex items-center gap-2">
        {close ? <CheckCircle2 size={19} className="text-brand" /> : <PauseCircle size={19} className="text-amber-500" />}
        {close ? 'Закрыть задачу' : 'Приостановить задачу'}
      </span>}
      footer={<>
        <Button onClick={() => setWork(null)} disabled={busy}>Отмена</Button>
        <Button variant="primary" icon={close ? CheckCircle2 : PauseCircle} onClick={submit} disabled={busy}>{close ? 'Закрыть задачу' : 'Приостановить'}</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl forest-pattern text-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-white/60">Задача</div>
            <div className="text-[14px] font-semibold truncate">{work.task.title}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11.5px] text-white/60 flex items-center gap-1 justify-end"><Clock size={11} />{timerHere ? 'Время работы' : 'Таймер не шёл'}</div>
            <Odometer value={fmtHMS(sec)} className="text-[20px] font-semibold" />
          </div>
        </div>
        <label className="block">
          <span className="block text-[13px] font-semibold text-ink mb-1.5">{close ? 'С каким итогом закрыта задача?' : 'Что сделано за это время?'}</span>
          <textarea ref={ref} rows={5} value={note} onChange={(e) => { setNote(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder={close ? 'Например: заменили патч-корды, линии протестированы, всё работает' : 'Например: проверил линии 214 и 216, осталось 3 кабинета — продолжу завтра'}
            className={cx('input', err && '!border-red-400')} />
          {err ? <span className="block text-[12px] text-red-600 mt-1">{err}</span>
            : <span className="block text-[11.5px] text-ink-3 mt-1">Отчёт появится в обсуждении задачи{timerHere ? ', время — в табеле' : ''}. Ctrl+Enter — сохранить</span>}
        </label>
      </div>
    </Modal>
  );
}
