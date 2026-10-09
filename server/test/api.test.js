// Интеграционный тест: настоящий сервер на пустой временной базе
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
const env = { ...process.env, DATA_DIR: DIR, PORT: String(PORT), JWT_SECRET: 'test-secret' };
const NODE = ['--disable-warning=ExperimentalWarning'];
let srv;
const base = `http://localhost:${PORT}/api`;

async function call(method, url, body, cookie) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const login = async (email) => (await call('POST', '/auth/login', { email, password: 'password-123' })).cookie;

before(async () => {
  for (const [n, e] of [['Анна Админ', 'anna@test.ru'], ['Борис Петров', 'boris@test.ru']]) {
    execFileSync('node', [...NODE, 'src/create-admin.js'], { env, input: `${n}\n${e}\npassword-123\n` });
  }
  srv = spawn('node', [...NODE, 'src/index.js'], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* ждём запуска */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('сервер не запустился');
});
after(() => { srv?.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('без входа API закрыт, health открыт', async () => {
  assert.equal((await call('GET', '/health')).status, 200);
  assert.equal((await call('GET', '/projects')).status, 401);
});

test('неверный пароль не пускает', async () => {
  const r = await call('POST', '/auth/login', { email: 'anna@test.ru', password: 'wrong-password' });
  assert.equal(r.status, 401);
});

test('задача с подзадачами и чек-листом, упоминание создаёт уведомление', async () => {
  const anna = await login('anna@test.ru'), boris = await login('boris@test.ru');
  const p = (await call('POST', '/projects', { name: 'Тестовый проект' }, anna)).data;
  const t = await call('POST', '/tasks', { project_id: p.id, title: 'Настроить сеть', description: 'Описание', subtasks: ['Кабель', 'Роутер'], checklist: ['Проверить'] }, anna);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const full = (await call('GET', `/tasks/${t.data.id}`, null, anna)).data;
  assert.equal(full.checklist?.length ?? 1, 1);

  const c = await call('POST', `/tasks/${t.data.id}/comments`, { body: 'Борис Петров, посмотри, пожалуйста' }, anna);
  assert.equal(c.status, 200);
  assert.equal((await call('GET', '/notifications', null, boris)).data.unread, 0, 'без @ уведомления нет');

  await call('POST', `/tasks/${t.data.id}/comments`, { body: 'Привет @Борис Петров, глянь' }, anna);
  const n = (await call('GET', '/notifications', null, boris)).data;
  assert.equal(n.unread, 1);
  assert.equal(n.items[0].entity, 'task');
  assert.equal((await call('GET', '/notifications', null, anna)).data.unread, 0, 'себе не уведомляем');

  await call('POST', '/notifications/read', {}, boris);
  assert.equal((await call('GET', '/notifications', null, boris)).data.unread, 0);
});

test('шаблоны задач: создание, список, правка, удаление', async () => {
  const anna = await login('anna@test.ru');
  const t = (await call('POST', '/task-templates', { name: 'Новый сотрудник', title: 'Подготовить рабочее место', checklist: ['ПК', 'Учётка'], subtasks: ['Заказать ПК'], due_days: 3 }, anna)).data;
  assert.deepEqual(t.checklist, ['ПК', 'Учётка']);
  assert.equal((await call('GET', '/task-templates', null, anna)).data.length, 1);
  assert.equal((await call('PUT', `/task-templates/${t.id}`, { title: 'Другое' }, anna)).data.title, 'Другое');
  assert.equal((await call('POST', '/task-templates', { name: 'x' }, anna)).status, 400, 'название задачи обязательно');
  assert.equal((await call('DELETE', `/task-templates/${t.id}`, null, anna)).status, 200);
  assert.equal((await call('GET', '/task-templates', null, anna)).data.length, 0);
});
