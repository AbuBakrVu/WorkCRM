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
import Calendar from './pages/Calendar';
import Catalog from './pages/Catalog';
import Invoices from './pages/Invoices';

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
        <Route path="calendar" element={<Calendar />} />
        <Route path="time" element={<TimeTracker />} />
        <Route path="team" element={<Team />} />
        <Route path="clients" element={<Clients />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="catalog" element={<Catalog />} />
        {isManager && <Route path="finance" element={<Finance />} />}
        {isManager && <Route path="invoices" element={<Invoices />} />}
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className={cx('flex items-center gap-2 pl-3.5 pr-4 h-11 rounded-full shadow-xl text-[13px] font-medium anim-toast',
          t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-forest text-white')}>
          {t.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} className="text-mint" />}
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
