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

  // Тот же объект учёта, что и у текущего таймера?
  const sameTarget = (t, p) => !!t && (p.task_id ? t.task_id === p.task_id
    : p.ticket_id ? t.ticket_id === p.ticket_id
    : !!p.project_id && !t.task_id && !t.ticket_id && t.project_id === p.project_id);

  const pauseTimer = useCallback(async () => {
    try { setTimer(await api.post('/time/pause')); toast('Таймер на паузе'); setVersion((v) => v + 1); }
    catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  const resumeTimer = useCallback(async () => {
    try { setTimer(await api.post('/time/resume')); toast('Таймер продолжен'); setVersion((v) => v + 1); }
    catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  // Тот же таймер не перезапускаем: если идёт — сообщаем, если на паузе — продолжаем
  const startTimer = useCallback(async (payload) => {
    if (sameTarget(timer, payload)) {
      if (timer.paused) return resumeTimer();
      toast('Таймер уже идёт'); return;
    }
    try {
      const t = await api.post('/time/start', payload);
      setTimer(t); toast(timer ? 'Предыдущий таймер остановлен, новый запущен' : 'Таймер запущен'); setVersion((v) => v + 1);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast, timer, resumeTimer]);

  const stopTimer = useCallback(async () => {
    try {
      const e = await api.post('/time/stop');
      const sec = e?.duration_sec ?? 0;
      const hms = [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
      setTimer(null); toast(`Записано ${hms} в табель`); bump();
    } catch (e) { toast(e.message, 'error'); }
  }, [toast, bump]);

  const logout = async () => { await api.post('/auth/logout'); setUser(null); };

  const isManager = user && ['admin', 'manager'].includes(user.role);
  const userById = (id) => users.find((u) => u.id === id);

  return (
    <AppCtx.Provider value={{ user, setUser, users, clients, projects, timer, startTimer, stopTimer, pauseTimer, resumeTimer, toast, toasts,
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

// Сколько секунд набежало у таймера (с учётом пауз)
export function timerSeconds(timer, now = Date.now()) {
  if (!timer) return 0;
  const acc = timer.accumulated_sec || 0;
  if (timer.paused || !timer.started_at) return acc;
  return acc + Math.max(0, (now - new Date(timer.started_at)) / 1000);
}
