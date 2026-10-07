import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined — ещё грузим, null — не вошёл
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [timer, setTimer] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [version, setVersion] = useState(0); // счётчик «что-то изменилось» для перезагрузки страниц

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const loadRefs = useCallback(async () => {
    const [u, c, p, t] = await Promise.all([api.get('/users'), api.get('/clients'), api.get('/projects'), api.get('/time/running')]);
    setUsers(u); setClients(c); setProjects(p); setTimer(t);
  }, []);

  const bump = useCallback(() => { setVersion((v) => v + 1); loadRefs().catch(() => {}); }, [loadRefs]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get('/auth/me').then(setUser).catch(() => setUser(null));
  }, []);
  useEffect(() => { if (user) loadRefs().catch(() => {}); }, [user, loadRefs]);

  // Таймер на ту же задачу/проект/заявку не перезапускаем — только сообщаем, что он уже идёт
  const startTimer = useCallback(async (payload) => {
    if (timer && (payload.task_id ? timer.task_id === payload.task_id
      : payload.ticket_id ? timer.ticket_id === payload.ticket_id
      : payload.project_id && !timer.task_id && !timer.ticket_id && timer.project_id === payload.project_id)) {
      toast('Таймер уже идёт'); return;
    }
    try {
      const t = await api.post('/time/start', payload);
      setTimer(t); toast(timer ? 'Предыдущий таймер остановлен, новый запущен' : 'Таймер запущен'); setVersion((v) => v + 1);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast, timer]);
  const stopTimer = useCallback(async () => {
    const e = await api.post('/time/stop');
    const sec = e?.duration_sec ?? 0;
    const hms = [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
    setTimer(null); toast(`Записано ${hms} в табель`); bump();
  }, [toast, bump]);

  const logout = async () => { await api.post('/auth/logout'); setUser(null); };

  const isManager = user && ['admin', 'manager'].includes(user.role);
  const userById = (id) => users.find((u) => u.id === id);

  return (
    <AppCtx.Provider value={{ user, setUser, users, clients, projects, timer, startTimer, stopTimer, toast, toasts,
      bump, version, logout, isManager, userById, loadRefs }}>
      {children}
    </AppCtx.Provider>
  );
}

// Загрузка данных с перезагрузкой при глобальных изменениях
export function useLoad(url, deps = []) {
  const { version, toast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    api.get(url).then((d) => { if (n === seq.current) setData(d); })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload, version]);
  return { data, setData, loading, reload };
}

// Тикающее «сейчас» для живых таймеров
export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(t); }, [interval]);
  return now;
}

// Значение в localStorage с безопасным фолбэком
export function useStored(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}
