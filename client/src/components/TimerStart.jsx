import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Modal, Field, Select, Button, nameOptions } from './ui';
import { useApp } from '../lib/store';
import { api } from '../lib/api';

export function TimerStartModal({ open, onClose, preset = {} }) {
  const { projects, startTimer, toast } = useApp();
  const [form, setForm] = useState({});
  const [tasks, setTasks] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [mode, setMode] = useState('project');

  useEffect(() => {
    if (!open) return;
    setForm({ project_id: null, task_id: null, ticket_id: null, description: '', ...preset });
    setMode(preset.ticket_id ? 'ticket' : 'project');
    api.get('/tickets').then((t) => setTickets(t.filter((x) => !['resolved', 'closed'].includes(x.status)))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!form.project_id) { setTasks([]); return; }
    api.get(`/tasks?project_id=${form.project_id}&open=1`).then(setTasks).catch(() => {});
  }, [form.project_id]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    try {
      const payload = mode === 'project'
        ? { project_id: form.project_id ? +form.project_id : null, task_id: form.task_id ? +form.task_id : null, description: form.description }
        : { ticket_id: form.ticket_id ? +form.ticket_id : null, description: form.description };
      await startTimer(payload);
      onClose();
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Запустить таймер" width={460}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="violet" icon={Play} onClick={submit}>Старт</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        <div className="flex p-1 bg-canvas rounded-full border border-line w-fit">
          {[['project', 'Проект / задача'], ['ticket', 'Заявка']].map(([v, l]) => (
            <button type="button" key={v} onClick={() => setMode(v)}
              className={`px-3.5 h-7 rounded-full text-[12.5px] font-medium ${mode === v ? 'bg-panel shadow-sm text-ink' : 'text-ink-3'}`}>{l}</button>
          ))}
        </div>
        {mode === 'project' ? (<>
          <Field label="Проект">
            <Select value={form.project_id} onChange={(v) => setForm((f) => ({ ...f, project_id: v, task_id: null }))} placeholder="Без проекта"
              search options={nameOptions(projects.filter((p) => p.status !== 'done'))} />
          </Field>
          <Field label="Задача">
            <Select value={form.task_id} onChange={set('task_id')} placeholder={form.project_id ? 'Без задачи' : 'Сначала выберите проект'} disabled={!form.project_id}
              search options={tasks.map((t) => ({ value: t.id, label: t.title }))} />
          </Field>
        </>) : (
          <Field label="Заявка">
            <Select value={form.ticket_id} onChange={set('ticket_id')} placeholder="Выберите заявку"
              search options={tickets.map((t) => ({ value: t.id, label: `#${t.id} ${t.title}` }))} />
          </Field>
        )}
        <Field label="Что делаю">
          <input className="input" value={form.description || ''} onChange={(e) => set('description')(e.target.value)} placeholder="Например: настройка коммутатора" autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
