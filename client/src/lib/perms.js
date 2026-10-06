// Права на задачу (повторяют серверную проверку taskPerms в routes.js — сервер всё равно проверит сам)
export function taskPerms(user, t) {
  if (!user || !t) return { edit: false, status: false };
  const admin = user.role === 'admin';
  const owner = t.created_by ? t.created_by === user.id : user.role === 'manager';
  const doer = t.assignee_id === user.id || (t.coassignee_ids || []).includes(user.id);
  return { edit: (admin || owner) && t.status !== 'done', del: admin || owner, status: admin || owner || doer };
}
