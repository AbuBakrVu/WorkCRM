import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { AppProvider, useApp } from './lib/store';
import Layout from './components/Layout';
import { Spinner, cx } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Tickets from './pages/Tickets';
import TimeTracker from './pages/TimeTracker';
import Team from './pages/Team';
import Clients from './pages/Clients';
import Pipeline from './pages/Pipeline';
import Finance from './pages/Finance';
import Settings from './pages/Settings';

function Gate() {
  const { user, isManager } = useApp();
  if (user === undefined) return <div className="h-full flex items-center justify-center"><Spinner /></div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="time" element={<TimeTracker />} />
        <Route path="team" element={<Team />} />
        <Route path="clients" element={<Clients />} />
        <Route path="pipeline" element={<Pipeline />} />
        {isManager && <Route path="finance" element={<Finance />} />}
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx('flex items-center gap-2 pl-3 pr-4 h-10 rounded-xl shadow-lg text-[13px] font-medium anim-pop',
          t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-ink text-white')}>
          {t.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} className="text-brand" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Gate />
        <Toasts />
      </BrowserRouter>
    </AppProvider>
  );
}
