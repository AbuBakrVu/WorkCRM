import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { Button, Card, Empty, Field, Modal, Select, ConfirmButton, UserPicker, Spinner, userOptions } from './ui';

const lines = (t) => (t || '').split('\n').map((x) => x.trim()).filter(Boolean);

export function TaskTemplatesSettings() {
  const { users, toast, bump } = useApp();
  const { data, loading } = useLoad('/task-templates');
  const [edit, setEdit] = useState(null);

  const open = (t) => setEdit(t ? { ...t, checklistText: t.checklist.join('\n'), subtasksText: t.subtasks.join('\n') }
    : { name: '', title: '', description: '', assignee_id: null, coassignee_ids: [], observer_ids: [], checklistText: '', subtasksText: '', due_days: 0 });
  const set = (k) => (v) => setEdit((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    if (!edit.title?.trim()) { toast('Укажите название задачи', 'error'); return; }
    const body = { name: edit.name?.trim() || edit.title.trim(), title: edit.title.trim(), description: edit.description || '', assignee_id: edit.assignee_id ? +edit.assignee_id : null,
      coassignee_ids: edit.coassignee_ids || [], observer_ids: edit.observer_ids || [], checklist: lines(edit.checklistText), subtasks: lines(edit.subtasksText), due_days: +edit.due_days || 0 };
    try {
      if (edit.id) await api.put(`/task-templates/${edit.id}`, body); else await api.post('/task-templates', body);
      setEdit(null); bump(); toast('Шаблон сохранён');
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (t) => { try { await api.del(`/task-templates/${t.id}`); bump(); } catch (e) { toast(e.message, 'error'); } };

  if (loading && !data) return <Spinner />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] text-ink-2">Заготовки типовых задач: при создании задачи выберите шаблон — название, описание, чек-лист и подзадачи подставятся сами.</p>
        <Button variant="primary" icon={Plus} onClick={() => open(null)}>Шаблон</Button>
      </div>
      {!data?.length ? <Empty title="Шаблонов пока нет" text="Создайте здесь или нажмите «Сохранить как шаблон» в форме новой задачи" /> : (
        <Card className="divide-y divide-line">
          {data.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium truncate">{t.name}</div>
                <div className="text-[12px] text-ink-3 truncate">{t.title}{t.checklist.length ? ` · чек-лист ${t.checklist.length}` : ''}{t.subtasks.length ? ` · подзадач ${t.subtasks.length}` : ''}{t.due_days ? ` · срок ${t.due_days} дн.` : ''}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</div>
              </div>
              <Button size="sm" icon={Pencil} onClick={() => open(t)}>Изменить</Button>
              <ConfirmButton onConfirm={() => remove(t)} />
            </div>
          ))}
        </Card>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Шаблон задачи' : 'Новый шаблон задачи'} width={600}
        footer={<><Button onClick={() => setEdit(null)}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
        {edit && (
          <div className="space-y-3.5">
            <Field label="Название шаблона"><input className="input" value={edit.name || ''} onChange={set('name')} placeholder="Например: Подключение нового сотрудника" /></Field>
            <Field label="Название задачи"><input className="input" value={edit.title || ''} onChange={set('title')} /></Field>
            <Field label="Описание"><textarea className="input" rows={4} value={edit.description || ''} onChange={set('description')} /></Field>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Исполнитель"><Select value={edit.assignee_id} onChange={set('assignee_id')} placeholder="Не назначен" search options={userOptions(users)} /></Field>
              <Field label="Срок, дней от создания"><input type="number" min="0" className="input" value={edit.due_days ?? 0} onChange={set('due_days')} /></Field>
              <Field label="Соисполнители"><UserPicker users={users} value={edit.coassignee_ids || []} onChange={set('coassignee_ids')} /></Field>
              <Field label="Наблюдатели"><UserPicker users={users} value={edit.observer_ids || []} onChange={set('observer_ids')} /></Field>
            </div>
            <Field label="Чек-лист" hint="Каждая строка — пункт"><textarea className="input" rows={3} value={edit.checklistText} onChange={set('checklistText')} /></Field>
            <Field label="Подзадачи" hint="Каждая строка — подзадача"><textarea className="input" rows={3} value={edit.subtasksText} onChange={set('subtasksText')} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
