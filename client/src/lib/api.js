// Тонкая обёртка над fetch: JSON, cookie-сессия, единая обработка ошибок
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Ошибка ${res.status}`);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  // Загрузка файла: тело — сам файл, имя и тип — в заголовках
  upload: async (url, file, caption = '') => {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name || 'файл'),
        'X-File-Type': file.type || '',
        ...(caption ? { 'X-Caption': encodeURIComponent(caption) } : {}),
      },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) onUnauthorized();
      throw new ApiError(res.status, data?.error || `Ошибка ${res.status}`);
    }
    return data;
  },
};

export const fileUrl = (id, inline = false) => `/api/files/${id}${inline ? '?inline=1' : ''}`;
export function fmtSize(b) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
