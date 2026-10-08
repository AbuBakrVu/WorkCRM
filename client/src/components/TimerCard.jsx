import { useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { useApp, useNow, timerSeconds } from '../lib/store';
import { fmtHMS } from '../lib/format';
import { Odometer, cx } from './ui';
import { TimerStartModal } from './TimerStart';

// Тёмно-зелёная карточка таймера: крупные «барабанные» цифры и круглые кнопки
export function TimerCard({ className }) {
  const { timer, stopTimer: rawStop, pauseTimer, resumeTimer, askWork } = useApp();
  const stopTimer = () => (timer?.task_id ? askWork({ id: timer.task_id, title: timer.task_title }, 'pause') : rawStop());
  const [startOpen, setStartOpen] = useState(false);
  const now = useNow();
  const elapsed = timerSeconds(timer, now);
  const what = timer ? (timer.task_title || timer.ticket_title || timer.description || timer.project_name || 'Без описания') : null;
  return (
    <div className={cx('relative rounded-[22px] forest-pattern text-white p-5 overflow-hidden flex flex-col min-h-[230px] lift', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">Таймер</div>
          <div className="text-[12px] text-white/60 truncate mt-0.5">{timer ? `${what}${timer.project_name && what !== timer.project_name ? ` · ${timer.project_name}` : ''}` : 'Сейчас ничего не учитывается'}</div>
        </div>
        {timer && (timer.paused
          ? <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium bg-amber-400/20 text-amber-200 rounded-full px-2.5 py-1"><Pause size={11} fill="currentColor" />На паузе</span>
          : <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium bg-white/10 rounded-full px-2.5 py-1"><span className="size-1.5 rounded-full bg-red-400 animate-pulse" />Идёт запись</span>)}
      </div>
      <div className="flex-1 flex items-center justify-center py-4">
        <Odometer value={fmtHMS(elapsed)} className={cx('text-[52px] font-semibold tracking-[-0.02em] transition-opacity', (!timer || timer.paused) && 'opacity-60', timer?.paused && 'animate-pulse')} />
      </div>
      <div className="flex items-center justify-center gap-3">
        {timer && (timer.paused ? (
          <button onClick={resumeTimer} title="Продолжить"
            className="size-12 rounded-full bg-[#eaf3ec] text-forest hover:bg-white flex items-center justify-center transition-transform active:scale-95">
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </button>
        ) : (
          <button onClick={pauseTimer} title="Пауза — время сохранится, можно продолжить"
            className="size-12 rounded-full bg-[#eaf3ec] text-forest hover:bg-white flex items-center justify-center transition-transform active:scale-95">
            <Pause size={18} fill="currentColor" />
          </button>
        ))}
        {timer ? (
          <button onClick={stopTimer} title="Остановить и записать в табель"
            className="size-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center shadow-[0_8px_20px_-8px_rgba(220,38,38,.9)] transition-transform active:scale-95">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button onClick={() => setStartOpen(true)} title="Запустить таймер"
            className="size-12 rounded-full bg-[#eaf3ec] text-forest hover:bg-white flex items-center justify-center transition-transform active:scale-95">
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </button>
        )}
      </div>
      <TimerStartModal open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}
