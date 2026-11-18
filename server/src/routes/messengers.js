// Мессенджеры: Telegram (бот) и WhatsApp (Green API).
// Входящие сообщения клиентов → заявки и переписка в карточке заявки, ответы из CRM уходят обратно в мессенджер.
// Сотрудники подключают Telegram в профиле и получают уведомления через того же бота.
// Оба канала работают «опросом» (long polling), поэтому не нужен публичный адрес — работает и на сервере в локальной сети.
import crypto from 'node:crypto';
import { all, get, run, logActivity } from '../db.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap, wrapAsync, insert, idParam, nowIso } from './shared.js';
import { getSetting, setSetting } from './companies.js';
import { SLA_HOURS } from './tickets.js';

const OPEN = ['new', 'in_progress', 'waiting'];
const CHANNEL_LABEL = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
const TG_API = (process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');

// Состояние каналов для экрана настроек (в памяти процесса)
const state = {
  telegram: { connected: false, error: null, bot: null, last_at: null },
  whatsapp: { connected: false, error: null, phone: null, last_at: null },
};

/* ---------- Telegram Bot API ---------- */
async function tgCall(method, params = {}, timeoutMs = 15000, token = getSetting('tg_token')) {
  if (!token) throw new Error('Telegram не настроен');
  const r = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await r.json().catch(() => null);
  if (!d?.ok) throw new Error(d?.description || `Telegram: ошибка ${r.status}`);
  return d.result;
}
const tgSend = (chatId, text, html = false) => tgCall('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), ...(html ? { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } : {}) });

/* ---------- WhatsApp через Green API ---------- */
function waConf() {
  const url = (getSetting('wa_api_url') || 'https://api.green-api.com').replace(/\/$/, '');
  const id = getSetting('wa_id_instance'); const token = getSetting('wa_api_token');
  return id && token ? { url, id, token } : null;
}
async function waCall(method, { httpMethod = 'GET', body, suffix = '', query = '', timeoutMs = 15000 } = {}) {
  const c = waConf();
  if (!c) throw new Error('WhatsApp не настроен');
  const r = await fetch(`${c.url}/waInstance${c.id}/${method}/${c.token}${suffix}${query}`, {
    method: httpMethod, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (r.status === 401 || r.status === 403) throw new Error('Green API отклонил idInstance или apiTokenInstance');
  if (!r.ok) throw new Error(`Green API: ошибка ${r.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  return text ? JSON.parse(text) : null;
}
const waSend = (chatId, text) => waCall('sendMessage', { httpMethod: 'POST', body: { chatId, message: String(text).slice(0, 4000) } });

/* ---------- отправка клиенту ---------- */
export async function sendToChat(chatId, text) {
  const chat = get('SELECT * FROM messenger_chats WHERE id = ?', chatId);
  if (!chat) throw new Error('Чат не найден');
  if (chat.channel === 'telegram') await tgSend(chat.external_id, text);
  else await waSend(chat.external_id, text);
  run('UPDATE messenger_chats SET last_message_at = ? WHERE id = ?', nowIso(), chat.id);
}

// Комментарий сотрудника, отправленный клиенту в мессенджер. Возвращает id комментария.
export async function replyToTicketChat(ticket, body, userId) {
  const chat = get('SELECT * FROM messenger_chats WHERE id = ?', ticket.messenger_chat_id);
  if (!chat) throw bad('У заявки нет переписки в мессенджере');
  const cid = insert('ticket_comments', { ticket_id: ticket.id, user_id: userId, body, internal: 0, channel: chat.channel, delivery: 'pending' });
  try {
    await sendToChat(chat.id, body);
    run("UPDATE ticket_comments SET delivery = 'sent' WHERE id = ?", cid);
  } catch (e) {
    run("UPDATE ticket_comments SET delivery = 'failed', delivery_error = ? WHERE id = ?", String(e.message).slice(0, 300), cid);
  }
  return cid;
}

// Автоматическое сообщение клиенту (принята / решена) — с записью в переписку заявки
async function systemReply(ticketId, chatId, text) {
  if (!text) return;
  const chat = get('SELECT channel FROM messenger_chats WHERE id = ?', chatId);
  const cid = insert('ticket_comments', { ticket_id: ticketId, body: text, internal: 0, channel: chat?.channel, sender_name: 'Автоответ', delivery: 'pending' });
  try { await sendToChat(chatId, text); run("UPDATE ticket_comments SET delivery = 'sent' WHERE id = ?", cid); }
  catch (e) { run("UPDATE ticket_comments SET delivery = 'failed', delivery_error = ? WHERE id = ?", String(e.message).slice(0, 300), cid); }
}
const fill = (tpl, ticketId) => String(tpl || '').replaceAll('{номер}', ticketId).replaceAll('{id}', ticketId).trim();

// Вызывается при смене статуса заявки на «Решена»
export function onTicketResolved(ticketId) {
  const t = get('SELECT id, messenger_chat_id FROM tickets WHERE id = ?', ticketId);
  const tpl = getSetting('msg_resolved');
  if (!t?.messenger_chat_id || !tpl) return;
  systemReply(t.id, t.messenger_chat_id, fill(tpl, t.id)).catch((e) => console.error('messenger:', e.message));
}

/* ---------- уведомления сотрудникам ---------- */
const baseUrl = () => (getSetting('public_url') || '').replace(/\/$/, '');
const ticketLink = (id) => (baseUrl() ? `${baseUrl()}/tickets?open=${id}` : null);
const taskLink = (projectId, id) => (baseUrl() ? `${baseUrl()}/projects?open=${projectId}&task=${id}` : null);
const managers = () => all("SELECT id FROM users WHERE active = 1 AND role IN ('admin','manager')").map((u) => u.id);

// Отправить сотрудникам в Telegram (если подключили и не отключили уведомления). Ошибки не мешают основной операции.
export function pushTeam(userIds, html, link) {
  if (!getSetting('tg_token')) return;
  const uniq = [...new Set((userIds || []).filter(Boolean).map(Number))];
  for (const uid of uniq) {
    const u = get('SELECT tg_chat_id FROM users WHERE id = ? AND active = 1 AND tg_notify = 1', uid);
    if (!u?.tg_chat_id) continue;
    tgSend(u.tg_chat_id, link ? `${html}\n\n<a href="${esc(link)}">Открыть в CRM →</a>` : html, true).catch((e) => console.error('telegram notify:', e.message));
  }
}
// Колокольчик в CRM + Telegram
function notifyUsers(userIds, { kind, entity, entityId, text, html, link, fromUserId = null }) {
  const uniq = [...new Set((userIds || []).filter(Boolean).map(Number))].filter((id) => id !== fromUserId);
  for (const uid of uniq) insert('notifications', { user_id: uid, kind, entity, entity_id: entityId, from_user_id: fromUserId, text: String(text || '').slice(0, 200) });
  pushTeam(uniq, html, link);
}
export function notifyTicketAssigned(ticketId, assigneeId, byUserId) {
  if (!assigneeId || assigneeId === byUserId) return;
  const t = get('SELECT id, title FROM tickets WHERE id = ?', ticketId);
  const by = byUserId && get('SELECT name FROM users WHERE id = ?', byUserId)?.name;
  notifyUsers([assigneeId], { kind: 'assigned', entity: 'ticket', entityId: t.id, fromUserId: byUserId, text: t.title,
    html: `📌 <b>Вам назначена заявка #${t.id}</b>\n${esc(t.title)}${by ? `\nНазначил: ${esc(by)}` : ''}`, link: ticketLink(t.id) });
}
export function notifyTaskAssigned(taskId, assigneeId, byUserId) {
  if (!assigneeId || assigneeId === byUserId) return;
  const t = get('SELECT t.id, t.title, t.project_id, t.due_date, p.name project FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?', taskId);
  if (!t) return;
  const by = byUserId && get('SELECT name FROM users WHERE id = ?', byUserId)?.name;
  notifyUsers([assigneeId], { kind: 'assigned', entity: 'task', entityId: t.id, fromUserId: byUserId, text: t.title,
    html: `📌 <b>Вам назначена задача</b>\n${esc(t.title)}\nПроект: ${esc(t.project)}${t.due_date ? `\nСрок: ${t.due_date.split('-').reverse().join('.')}` : ''}${by ? `\nПоставил: ${esc(by)}` : ''}`,
    link: taskLink(t.project_id, t.id) });
}
// Упоминание @Имя (колокольчик пишет tasks.js — здесь только Telegram)
export function pushMention({ userId, authorId, entity, entityId, text }) {
  const author = authorId && get('SELECT name FROM users WHERE id = ?', authorId)?.name;
  let title, link;
  if (entity === 'ticket') { title = `заявка #${entityId} «${get('SELECT title FROM tickets WHERE id = ?', entityId)?.title || ''}»`; link = ticketLink(entityId); }
  else { const t = get('SELECT title, project_id FROM tasks WHERE id = ?', entityId); title = `задача «${t?.title || ''}»`; link = t && taskLink(t.project_id, entityId); }
  pushTeam([userId], `💬 <b>${esc(author || 'Коллега')} упомянул(а) вас</b> — ${esc(title)}\n\n${esc(String(text).slice(0, 500))}`, link);
}

// Просроченный SLA открытых заявок — одно уведомление на заявку (вызывается планировщиком)
export function runSlaAlerts() {
  const list = all(`SELECT id, title, assignee_id FROM tickets WHERE status IN ('new','in_progress') AND due_at IS NOT NULL
    AND due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') AND sla_notified_at IS NULL`);
  for (const t of list) {
    run('UPDATE tickets SET sla_notified_at = ? WHERE id = ?', nowIso(), t.id);
    notifyUsers(t.assignee_id ? [t.assignee_id] : managers(), { kind: 'sla', entity: 'ticket', entityId: t.id, text: t.title,
      html: `⏰ <b>Просрочен SLA по заявке #${t.id}</b>\n${esc(t.title)}`, link: ticketLink(t.id) });
  }
}

/* ---------- входящие сообщения ---------- */
// Клиент CRM по номеру телефона (сравниваем последние 10 цифр)
function clientByPhone(phone) {
  const p = digits(phone).slice(-10);
  if (p.length < 10) return null;
  for (const c of all('SELECT id, phone FROM clients WHERE phone IS NOT NULL')) {
    if (String(c.phone).split(/[,;]/).some((x) => digits(x).slice(-10) === p)) return c.id;
  }
  return null;
}

export function handleInbound({ channel, externalId, name, phone, username, text, fromPhone = false }) {
  text = String(text || '').trim().slice(0, 5000);
  if (!text) return null;
  let chat = get('SELECT * FROM messenger_chats WHERE channel = ? AND external_id = ?', channel, String(externalId));
  if (!chat) {
    const id = insert('messenger_chats', { channel, external_id: String(externalId), name: name || null, phone: phone || null, username: username || null, client_id: clientByPhone(phone) });
    chat = get('SELECT * FROM messenger_chats WHERE id = ?', id);
  } else if (!fromPhone && (name && name !== chat.name || username && username !== chat.username)) {
    run('UPDATE messenger_chats SET name = COALESCE(?, name), username = COALESCE(?, username) WHERE id = ?', name || null, username || null, chat.id);
  }
  run('UPDATE messenger_chats SET last_message_at = ? WHERE id = ?', nowIso(), chat.id);
  const open = get(`SELECT id, title, status, assignee_id FROM tickets WHERE messenger_chat_id = ? AND status IN ('new','in_progress','waiting') ORDER BY id DESC LIMIT 1`, chat.id);

  // Сообщение, отправленное сотрудником прямо с телефона WhatsApp, — в переписку открытой заявки
  if (fromPhone) {
    if (open) insert('ticket_comments', { ticket_id: open.id, body: text, internal: 0, channel, sender_name: 'С телефона', delivery: 'sent' });
    return open?.id ?? null;
  }
  const who = chat.name || name || (chat.username ? `@${chat.username}` : chat.phone) || 'Клиент';
  const label = CHANNEL_LABEL[channel];
  if (open) {
    insert('ticket_comments', { ticket_id: open.id, body: text, internal: 0, channel, inbound: 1, sender_name: who });
    if (open.status === 'waiting') run("UPDATE tickets SET status = 'in_progress' WHERE id = ?", open.id);
    notifyUsers(open.assignee_id ? [open.assignee_id] : managers(), { kind: 'message', entity: 'ticket', entityId: open.id, text,
      html: `✉️ <b>${esc(who)}</b> · ${label} · заявка #${open.id}\n\n${esc(text.slice(0, 1000))}`, link: ticketLink(open.id) });
    return open.id;
  }
  // Новая заявка
  const title = text.split('\n')[0].slice(0, 80) + (text.split('\n')[0].length > 80 ? '…' : '');
  const contact = [chat.phone && `+${digits(chat.phone)}`, chat.username && `@${chat.username}`, label].filter(Boolean).join(' · ');
  const projectId = Number(getSetting('msg_project_id')) || null;
  const ticketId = insert('tickets', {
    title, description: text, priority: 'normal', status: 'new', requester: who, requester_contact: contact,
    client_id: chat.client_id, project_id: projectId && get('SELECT 1 FROM projects WHERE id = ?', projectId) ? projectId : null,
    messenger_chat_id: chat.id, due_at: new Date(Date.now() + (SLA_HOURS.normal || 24) * 3600e3).toISOString(),
  });
  insert('ticket_comments', { ticket_id: ticketId, body: text, internal: 0, channel, inbound: 1, sender_name: who });
  logActivity(null, 'ticket', ticketId, 'create', `новая заявка #${ticketId} из ${label}: «${title}»`);
  notifyUsers(managers(), { kind: 'ticket', entity: 'ticket', entityId: ticketId, text: title,
    html: `🆕 <b>Новая заявка #${ticketId}</b> · ${label}\nОт: ${esc(who)}${chat.phone ? ` (+${digits(chat.phone)})` : ''}\n\n${esc(text.slice(0, 1000))}`, link: ticketLink(ticketId) });
  const auto = fill(getSetting('msg_autoreply'), ticketId);
  if (auto) systemReply(ticketId, chat.id, auto).catch((e) => console.error('messenger:', e.message));
  return ticketId;
}

/* ---------- Telegram: разбор входящих ---------- */
const linkCodes = new Map(); // код привязки → { userId, exp }

function tgText(m) {
  const parts = [];
  if (m.photo) parts.push('[фото]');
  if (m.document) parts.push(`[файл: ${m.document.file_name || 'документ'}]`);
  if (m.voice) parts.push('[голосовое сообщение]');
  if (m.video) parts.push('[видео]');
  if (m.sticker) parts.push(m.sticker.emoji || '[стикер]');
  if (m.contact) parts.push(`[контакт: ${[m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ')} ${m.contact.phone_number}]`);
  if (m.location) parts.push(`[геопозиция: ${m.location.latitude}, ${m.location.longitude}]`);
  const t = m.text || m.caption || '';
  return [parts.join(' '), t].filter(Boolean).join(parts.length && t ? '\n' : '');
}

export async function handleTelegramUpdate(u) {
  const m = u.message;
  if (!m || m.chat?.type !== 'private' || m.from?.is_bot) return;
  const chatId = String(m.chat.id);
  const text = String(m.text || '');

  // Привязка сотрудника: /start link_<код>
  const link = text.match(/^\/start\s+link_([\w-]+)/);
  if (link) {
    const rec = linkCodes.get(link[1]);
    if (!rec || rec.exp < Date.now()) return tgSend(chatId, 'Ссылка для подключения устарела. Откройте CRM → Профиль и нажмите «Подключить Telegram» ещё раз.');
    linkCodes.delete(link[1]);
    run('UPDATE users SET tg_chat_id = NULL WHERE tg_chat_id = ?', chatId);
    run('UPDATE users SET tg_chat_id = ?, tg_notify = 1 WHERE id = ?', chatId, rec.userId);
    const name = get('SELECT name FROM users WHERE id = ?', rec.userId)?.name;
    return tgSend(chatId, `✅ Готово, ${name}! Сюда будут приходить уведомления CRM: новые заявки, назначения, упоминания и сообщения клиентов.`);
  }
  const staff = get('SELECT name FROM users WHERE tg_chat_id = ? AND active = 1', chatId);
  if (staff) return tgSend(chatId, `Этот чат подключён к уведомлениям CRM (${staff.name}). Отвечать клиентам можно в карточке заявки.`);

  if (/^\/start\b/.test(text)) {
    const hello = getSetting('msg_greeting') || 'Здравствуйте! Опишите, пожалуйста, вашу проблему или вопрос — мы создадим заявку и ответим здесь.';
    return tgSend(chatId, hello);
  }
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || null;
  const phone = m.contact?.user_id === m.from?.id ? m.contact.phone_number : null;
  handleInbound({ channel: 'telegram', externalId: chatId, name, username: m.from?.username || null, phone, text: tgText(m) });
}

/* ---------- WhatsApp (Green API): разбор входящих ---------- */
function waText(md) {
  if (!md) return '';
  switch (md.typeMessage) {
    case 'textMessage': return md.textMessageData?.textMessage || '';
    case 'extendedTextMessage': case 'quotedMessage': return md.extendedTextMessageData?.text || md.textMessageData?.textMessage || '';
    case 'imageMessage': case 'videoMessage': case 'documentMessage': case 'audioMessage': {
      const f = md.fileMessageData || {};
      const kind = { imageMessage: 'фото', videoMessage: 'видео', documentMessage: `файл: ${f.fileName || 'документ'}`, audioMessage: 'аудио' }[md.typeMessage];
      return [`[${kind}]${f.downloadUrl ? ` ${f.downloadUrl}` : ''}`, f.caption].filter(Boolean).join('\n');
    }
    case 'locationMessage': return `[геопозиция: ${md.locationMessageData?.latitude}, ${md.locationMessageData?.longitude}]`;
    case 'contactMessage': return `[контакт: ${md.contactMessageData?.displayName || ''}]`;
    default: return md.typeMessage ? `[${md.typeMessage}]` : '';
  }
}
export function handleWhatsappNotification(body) {
  const type = body?.typeWebhook;
  if (type === 'stateInstanceChanged') { state.whatsapp.connected = body.stateInstance === 'authorized'; return; }
  if (!['incomingMessageReceived', 'outgoingMessageReceived'].includes(type)) return;
  const chatId = body.senderData?.chatId || '';
  if (!chatId.endsWith('@c.us')) return; // группы и рассылки не обрабатываем
  handleInbound({
    channel: 'whatsapp', externalId: chatId, phone: chatId.replace('@c.us', ''),
    name: type === 'incomingMessageReceived' ? (body.senderData?.senderName || body.senderData?.chatName || null) : null,
    text: waText(body.messageData), fromPhone: type === 'outgoingMessageReceived',
  });
}

/* ---------- циклы опроса ---------- */
let tgGen = 0, waGen = 0;
async function tgLoop(gen) {
  let offset = Number(getSetting('tg_offset')) || 0;
  while (gen === tgGen) {
    if (!getSetting('tg_token')) { state.telegram.connected = false; await sleep(15000); continue; }
    try {
      const updates = await tgCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
      state.telegram.connected = true; state.telegram.error = null; state.telegram.last_at = nowIso();
      for (const u of updates) {
        offset = u.update_id + 1;
        setSetting('tg_offset', String(offset));
        try { await handleTelegramUpdate(u); } catch (e) { console.error('telegram update:', e.message); }
      }
    } catch (e) {
      if (gen !== tgGen) return;
      state.telegram.connected = false; state.telegram.error = e.message;
      await sleep(10000);
    }
  }
}
async function waLoop(gen) {
  while (gen === waGen) {
    if (!waConf()) { state.whatsapp.connected = false; await sleep(15000); continue; }
    try {
      const n = await waCall('receiveNotification', { query: '?receiveTimeout=20', timeoutMs: 30000 });
      state.whatsapp.error = null; state.whatsapp.last_at = nowIso();
      if (!n) continue;
      try { handleWhatsappNotification(n.body); } catch (e) { console.error('whatsapp notification:', e.message); }
      await waCall('deleteNotification', { httpMethod: 'DELETE', suffix: `/${n.receiptId}` });
    } catch (e) {
      if (gen !== waGen) return;
      state.whatsapp.error = e.message;
      await sleep(10000);
    }
  }
}
async function refreshWaState() {
  if (!waConf()) { state.whatsapp.connected = false; return; }
  try {
    const s = await waCall('getStateInstance');
    state.whatsapp.connected = s?.stateInstance === 'authorized';
    state.whatsapp.error = state.whatsapp.connected ? null : `Статус инстанса: ${s?.stateInstance || 'неизвестно'} — отсканируйте QR-код в личном кабинете Green API`;
  } catch (e) { state.whatsapp.connected = false; state.whatsapp.error = e.message; }
}
export function startMessengers() {
  if (process.env.MESSENGERS === 'off') return;
  tgLoop(++tgGen);
  waLoop(++waGen);
  refreshWaState();
}

/* ---------- API настроек ---------- */
const KEYS = ['tg_token', 'wa_api_url', 'wa_id_instance', 'wa_api_token', 'msg_greeting', 'msg_autoreply', 'msg_resolved', 'msg_project_id'];
const SECRETS = ['tg_token', 'wa_api_token'];
const mask = (v) => (v ? `••••${v.slice(-4)}` : '');

api.get('/messengers', requireRole('admin'), wrap(() => {
  const s = {};
  for (const k of KEYS) s[k] = SECRETS.includes(k) ? mask(getSetting(k)) : getSetting(k) || '';
  return { settings: s, state, public_url: getSetting('public_url') || '' };
}));

api.put('/messengers', requireRole('admin'), wrapAsync(async (req) => {
  const b = req.body || {};
  const tgBefore = getSetting('tg_token');
  const waBefore = [getSetting('wa_api_url'), getSetting('wa_id_instance'), getSetting('wa_api_token')].join('|');
  for (const k of KEYS) {
    if (!(k in b)) continue;
    const v = b[k] == null ? '' : String(b[k]).trim();
    if (SECRETS.includes(k) && v.startsWith('••••')) continue; // не меняли
    setSetting(k, v ? v.slice(0, 2000) : null);
  }
  // адрес CRM для ссылок в уведомлениях — по адресу, с которого администратор сохраняет настройки
  const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
  if (origin && !/localhost|127\.0\.0\.1/.test(origin)) setSetting('public_url', origin);

  const tgNow = getSetting('tg_token');
  if (tgNow !== tgBefore) {
    state.telegram = { connected: false, error: null, bot: null, last_at: null };
    setSetting('tg_offset', null);
    if (tgNow) {
      try {
        const me = await tgCall('getMe', {}, 10000, tgNow);
        await tgCall('deleteWebhook', {}, 10000, tgNow); // иначе getUpdates не работает
        state.telegram.bot = me.username;
        setSetting('tg_bot_username', me.username);
      } catch (e) { state.telegram.error = e.message; throw bad(`Telegram не принял токен: ${e.message}`); }
    } else setSetting('tg_bot_username', null);
    tgLoop(++tgGen);
  }
  const waNow = [getSetting('wa_api_url'), getSetting('wa_id_instance'), getSetting('wa_api_token')].join('|');
  if (waNow !== waBefore) {
    state.whatsapp = { connected: false, error: null, phone: null, last_at: null };
    if (waConf()) {
      try {
        // уведомления забираем опросом: webhook должен быть пустым; входящие и отправленные с телефона — включены
        await waCall('setSettings', { httpMethod: 'POST', body: { webhookUrl: '', incomingWebhook: 'yes', outgoingMessageWebhook: 'yes', outgoingAPIMessageWebhook: 'no', stateWebhook: 'yes' } });
      } catch (e) { state.whatsapp.error = e.message; }
      await refreshWaState();
    }
    waLoop(++waGen);
  }
  logActivity(req.user.id, 'settings', null, 'update', 'изменил настройки мессенджеров');
  if (!state.telegram.bot && tgNow) state.telegram.bot = getSetting('tg_bot_username');
  return { ok: true, state };
}));

api.post('/messengers/check', requireRole('admin'), wrapAsync(async () => {
  if (getSetting('tg_token')) {
    try { const me = await tgCall('getMe', {}, 10000); state.telegram.bot = me.username; state.telegram.error = null; } catch (e) { state.telegram.error = e.message; state.telegram.connected = false; }
  }
  await refreshWaState();
  return { state };
}));

// Пробное сообщение в WhatsApp на номер (проверка отправки)
api.post('/messengers/whatsapp/test', requireRole('admin'), wrapAsync(async (req) => {
  const phone = digits(req.body?.phone);
  if (phone.length < 10) throw bad('Укажите номер в формате 7XXXXXXXXXX');
  const num = phone.length === 10 ? `7${phone}` : phone.replace(/^8(\d{10})$/, '7$1');
  try { await waSend(`${num}@c.us`, String(req.body?.text || 'Проверка связи из CRM ✅')); } catch (e) { throw bad(e.message); }
  return { ok: true };
}));

/* ---------- Telegram сотрудника (профиль) ---------- */
api.post('/messengers/telegram/link', wrap((req) => {
  const bot = getSetting('tg_bot_username');
  if (!getSetting('tg_token') || !bot) throw bad('Telegram-бот не подключён. Администратор настраивает его в Настройки → Интеграции');
  const code = crypto.randomBytes(12).toString('base64url');
  for (const [k, v] of linkCodes) if (v.exp < Date.now() || v.userId === req.user.id) linkCodes.delete(k);
  linkCodes.set(code, { userId: req.user.id, exp: Date.now() + 15 * 60e3 });
  return { url: `https://t.me/${bot}?start=link_${code}` };
}));
api.delete('/messengers/telegram/link', wrap((req) => {
  run('UPDATE users SET tg_chat_id = NULL WHERE id = ?', req.user.id);
  return { ok: true };
}));
api.get('/messengers/telegram/me', wrap((req) => {
  const u = get('SELECT tg_chat_id, tg_notify FROM users WHERE id = ?', req.user.id);
  return { linked: !!u?.tg_chat_id, notify: !!u?.tg_notify, bot: getSetting('tg_token') ? getSetting('tg_bot_username') : null };
}));

/* ---------- чат заявки ---------- */
api.get('/tickets/:id/chat', wrap((req) => {
  const t = get('SELECT messenger_chat_id FROM tickets WHERE id = ?', idParam(req));
  if (!t) throw notFound();
  return t.messenger_chat_id ? get('SELECT id, channel, name, phone, username, client_id FROM messenger_chats WHERE id = ?', t.messenger_chat_id) : null;
}));

// Начать переписку с клиентом в WhatsApp из заявки, созданной вручную (по номеру)
api.post('/tickets/:id/chat', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const t = get('SELECT * FROM tickets WHERE id = ?', id);
  if (!t) throw notFound();
  if (!waConf()) throw bad('WhatsApp не подключён');
  let phone = digits(req.body?.phone);
  if (phone.length === 10) phone = `7${phone}`;
  phone = phone.replace(/^8(\d{10})$/, '7$1');
  if (phone.length < 11) throw bad('Укажите номер в формате +7XXXXXXXXXX');
  const ext = `${phone}@c.us`;
  let chat = get("SELECT id FROM messenger_chats WHERE channel = 'whatsapp' AND external_id = ?", ext);
  if (!chat) chat = { id: insert('messenger_chats', { channel: 'whatsapp', external_id: ext, phone, name: t.requester || null, client_id: t.client_id || clientByPhone(phone) }) };
  run('UPDATE tickets SET messenger_chat_id = ? WHERE id = ?', chat.id, id);
  return get('SELECT id, channel, name, phone, username, client_id FROM messenger_chats WHERE id = ?', chat.id);
}));

// Повторить отправку недоставленного сообщения
api.post('/ticket-comments/:id/resend', wrapAsync(async (req) => {
  const c = get('SELECT * FROM ticket_comments WHERE id = ?', idParam(req));
  if (!c || c.delivery !== 'failed') throw bad('Сообщение не требует повторной отправки');
  const t = get('SELECT messenger_chat_id FROM tickets WHERE id = ?', c.ticket_id);
  if (!t?.messenger_chat_id) throw bad('У заявки нет переписки в мессенджере');
  try { await sendToChat(t.messenger_chat_id, c.body); run("UPDATE ticket_comments SET delivery = 'sent', delivery_error = NULL WHERE id = ?", c.id); }
  catch (e) { run('UPDATE ticket_comments SET delivery_error = ? WHERE id = ?', String(e.message).slice(0, 300), c.id); throw bad(`Не отправлено: ${e.message}`); }
  return { ok: true };
}));
