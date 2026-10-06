// Создание администратора или сброс его пароля из консоли.
// Данные читаются из stdin тремя строками: имя, email, пароль (пароль не попадает в историю shell и список процессов).
//   printf '%s\n%s\n%s\n' "Имя" "mail@example.ru" "пароль" | npm run --silent create-admin
// Если пользователь с таким email уже есть — ему ставится новый пароль, роль admin и он активируется.
import { get, run } from './db.js';
import { hashPassword } from './auth.js';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const [name = '', email = '', password = ''] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map((s) => s.trim());

const fail = (msg) => { console.error(`Ошибка: ${msg}`); process.exit(1); };
if (!name) fail('не указано имя');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('некорректный email');
if (password.length < 8) fail('пароль должен быть не короче 8 символов');

const existing = get('SELECT id FROM users WHERE email = ?', email);
if (existing) {
  run("UPDATE users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?", name, hashPassword(password), existing.id);
  console.log(`Пароль администратора ${email} обновлён`);
} else {
  run("INSERT INTO users (name, email, password_hash, role, position, color) VALUES (?, ?, ?, 'admin', 'Администратор', '#4f46e5')",
    name, email, hashPassword(password));
  console.log(`Администратор ${email} создан`);
}
