import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { fmtDate, fmtHM } from '../lib/format';
import { Spinner } from '../components/ui';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const long = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const hrs = (sec) => `${(Math.round((sec / 3600) * 10) / 10).toString().replace('.', ',')} ч`;

// Печатная форма «Отчёт о выполненных работах» — открывается отдельной вкладкой, печать / PDF через браузер
export default function ClientReport() {
  const [params] = useSearchParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    const q = new URLSearchParams(params);
    if (q.get('contract') && q.get('month')) { // из абонентского договора: весь месяц
      const [y, m] = q.get('month').split('-').map(Number);
      q.set('contract_id', q.get('contract')); q.set('from', `${q.get('month')}-01`);
      q.set('to', `${q.get('month')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`);
    }
    api.get(`/reports/client?${q}`).then(setD).catch((e) => setErr(e.message));
  }, [params]);
  useEffect(() => { if (d) document.title = `Отчёт ${d.client?.name || d.project?.name || ''} ${long(d.from)} — ${long(d.to)}`; }, [d]);
  if (err) return <div className="p-10 text-red-600">{err}</div>;
  if (!d) return <Spinner />;
  const who = d.client?.full_name || d.client?.name || d.project?.name;
  const k = d.contract;
  const usedH = d.total_sec / 3600;
  return (
    <div className="report-page min-h-full bg-canvas py-8 print:py-0 print:bg-white">
      <style>{`@media print { @page { size: A4; margin: 14mm 12mm; } .no-print { display: none !important; } html, body { background: #fff !important; } }
        .report-page { color-scheme: light; } .report-sheet { --color-ink: #17201b; --color-ink-2: #48524c; --color-ink-3: #879088; --color-line: #e3e8e4; }`}</style>
      <div className="no-print max-w-[820px] mx-auto mb-4 flex justify-end gap-2 px-4">
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-brand text-white font-semibold text-[13.5px]"><Printer size={16} />Печать / сохранить в PDF</button>
      </div>
      <div className="report-sheet max-w-[820px] mx-auto bg-white text-[#17201b] shadow-xl print:shadow-none rounded-2xl print:rounded-none p-10 print:p-0 text-[13px] leading-relaxed">
        <div className="flex items-start justify-between gap-6 pb-5 border-b-2 border-[#1e6a45]">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#879088]">Отчёт о выполненных работах</div>
            <h1 className="text-[22px] font-bold mt-1 leading-tight">{who}</h1>
            <div className="text-[#48524c] mt-1">за период с {long(d.from)} по {long(d.to)}</div>
          </div>
          {d.company && (
            <div className="text-right text-[12px] text-[#48524c] shrink-0 max-w-[260px]">
              {d.company.logo_file_id && <img src={fileUrl(d.company.logo_file_id, true)} alt="" className="max-h-12 ml-auto mb-2 object-contain" />}
              <div className="font-semibold text-[#17201b]">{d.company.full_name || d.company.name}</div>
              {d.company.inn && <div>ИНН {d.company.inn}{d.company.kpp ? ` / КПП ${d.company.kpp}` : ''}</div>}
              {d.company.phone && <div>{d.company.phone}</div>}{d.company.email && <div>{d.company.email}</div>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 my-6">
          <Box label="Затрачено времени" value={hrs(d.total_sec)} />
          <Box label="Закрыто задач" value={d.closed.length} />
          <Box label="Решено заявок" value={d.tickets.length} />
          {k && (<>
            <Box label="Лимит по договору" value={`${String(k.hours_limit).replace('.', ',')} ч`} />
            <Box label="Остаток" value={usedH <= k.hours_limit ? `${(Math.round((k.hours_limit - usedH) * 10) / 10).toString().replace('.', ',')} ч` : '—'} />
            <Box label="Сверх лимита" value={usedH > k.hours_limit ? `${(Math.round((usedH - k.hours_limit) * 10) / 10).toString().replace('.', ',')} ч` : 'нет'} warn={usedH > k.hours_limit} />
          </>)}
        </div>

        {d.closed.length > 0 && (
          <Sect title="Выполненные задачи">
            {d.closed.map((t) => (
              <div key={t.id} className="py-2.5 border-b border-[#e3e8e4] last:border-0 break-inside-avoid">
                <div className="flex justify-between gap-4"><span className="font-semibold">{t.title}</span><span className="text-[#879088] shrink-0">{fmtDate(t.completed_at, true)}</span></div>
                {t.result && <div className="text-[#48524c] mt-0.5 whitespace-pre-wrap">{t.result}</div>}
              </div>
            ))}
          </Sect>
        )}
        {d.tickets.length > 0 && (
          <Sect title="Решённые заявки">
            {d.tickets.map((t) => (
              <div key={t.id} className="py-2.5 border-b border-[#e3e8e4] last:border-0 break-inside-avoid">
                <div className="flex justify-between gap-4"><span className="font-semibold">№ {t.id}. {t.title}</span><span className="text-[#879088] shrink-0">{fmtDate(t.resolved_at, true)}</span></div>
                {t.resolution && <div className="text-[#48524c] mt-0.5 whitespace-pre-wrap">{t.resolution}</div>}
              </div>
            ))}
          </Sect>
        )}
        <Sect title="Учёт времени">
          {!d.work.length ? <div className="text-[#879088]">За период работ не учтено</div> : (
            <table className="w-full">
              <thead><tr className="text-left text-[11.5px] text-[#879088] border-b border-[#e3e8e4]"><th className="py-1.5 font-medium">Работа</th><th className="py-1.5 font-medium">Даты</th><th className="py-1.5 font-medium text-right">Время, ч:мм</th></tr></thead>
              <tbody>
                {d.work.map((w, i) => (
                  <tr key={i} className="border-b border-[#e3e8e4] align-top break-inside-avoid">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{w.task_title || (w.ticket_id ? `Заявка № ${w.ticket_id}. ${w.ticket_title}` : 'Прочие работы')}</div>
                      {w.notes.length > 0 && <ul className="text-[12px] text-[#48524c] mt-0.5 list-disc pl-4">{w.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-[#48524c]">{w.first_day === w.last_day ? fmtDate(w.first_day, true) : `${fmtDate(w.first_day)} — ${fmtDate(w.last_day, true)}`}</td>
                    <td className="py-2 text-right whitespace-nowrap tabular font-medium">{fmtHM(w.sec)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td className="pt-2 font-semibold" colSpan={2}>Итого</td><td className="pt-2 text-right font-bold tabular">{fmtHM(d.total_sec)}</td></tr></tfoot>
            </table>
          )}
        </Sect>
        <div className="mt-10 grid grid-cols-2 gap-10 text-[12px] text-[#48524c] break-inside-avoid">
          <div>Исполнитель<div className="mt-8 border-t border-[#879088] pt-1">{d.company?.director_name || ''}</div></div>
          <div>Заказчик<div className="mt-8 border-t border-[#879088] pt-1">{d.client?.director_name || ''}</div></div>
        </div>
      </div>
    </div>
  );
}
function Box({ label, value, warn }) {
  return <div className={`rounded-xl p-3 ${warn ? 'bg-[#fdeceb]' : 'bg-[#f1f4f2]'}`}><div className="text-[11px] text-[#879088]">{label}</div><div className={`text-[18px] font-bold mt-0.5 ${warn ? 'text-[#c0392b]' : ''}`}>{value}</div></div>;
}
function Sect({ title, children }) {
  return <section className="mt-6"><h2 className="text-[14px] font-bold uppercase tracking-wide text-[#1e6a45] mb-2">{title}</h2>{children}</section>;
}
