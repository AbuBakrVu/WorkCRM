import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { PROJECT_STATUS } from '../lib/constants';
import { Modal, Field, Select, Button, UserPicker, ConfirmButton, userOptions, nameOptions } from './ui';

// Проект = обслуживаемая организация (Минфин, университет, СДЭК…)
export function ProjectFormModal({ open, onClose, onSaved, project }) {
  const { users, clients, user, toast, bump, isManager } = useApp();
  const [f, setF] = useState({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setMore(false);
    setF(project ? { ...project } : { name: '', description: '', status: 'in_progress', member_ids: [user.id], owner_id: user.id });
  }, [open, project, user.id]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.name?.trim()) return toast('Укажите название организации', 'error');
    setBusy(true);
    try {
      const body = { name: f.name.trim(), description: f.description, status: f.status, client_id: f.client_id ? +f.client_id : null,
        owner_id: f.owner_id ? +f.owner_id : null, start_date: f.start_date || null, due_date: f.due_date || null,
        budget: f.budget ? +f.budget : 0, member_ids: f.member_ids };
      const p = project ? await api.put(`/projects/${project.id}`, body) : await api.post('/projects', body);
      toast(project ? 'Проект сохранён' : 'Проект создан');
      bump(); onSaved?.(p); onClose();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await api.del(`/projects/${project.id}`); toast('Проект удалён'); bump(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal open={open} onClose={onClose} title={project ? 'Настройки проекта' : 'Новый проект'} width={560}
      footer={<>
        {project && isManager && <div className="mr-auto"><ConfirmButton onConfirm={remove}>Удалить проект</ConfirmButton></div>}
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>{project ? 'Сохранить' : 'Создать проект'}</Button>
      </>}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Организация" hint="Например: Министерство финансов ЧР, СДЭК, ЧГУ">
          <input className="input" value={f.name || ''} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Описание"><textarea className="input" rows={3} value={f.description || ''} onChange={set('description')} placeholder="Что обслуживаем, контакты, адрес" /></Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Ответственный"><Select value={f.owner_id} onChange={set('owner_id')} placeholder="—" search options={userOptions(users)} /></Field>
          <Field label="Участники"><UserPicker users={users} value={f.member_ids || []} onChange={set('member_ids')} /></Field>
        </div>

        <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
          {more ? <ChevronDown size={15} /> : <ChevronRight size={15} />}Дополнительно
        </button>
        {more && (
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Статус"><Select value={f.status} onChange={set('status')} options={Object.entries(PROJECT_STATUS).map(([value, s]) => ({ value, label: s.label }))} /></Field>
            <Field label="Клиент (раздел «Клиенты»)"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
            <Field label="Начало"><input type="date" className="input" value={f.start_date || ''} onChange={set('start_date')} /></Field>
            <Field label="Срок договора"><input type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} /></Field>
            <Field label="Бюджет, ₽"><input type="number" min="0" className="input" value={f.budget || ''} onChange={set('budget')} /></Field>
          </div>
        )}
      </form>
    </Modal>
  );
}
