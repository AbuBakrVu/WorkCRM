import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Receipt, Wallet, BarChart3, Monitor, BookOpen } from 'lucide-react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { AppProvider, useApp } from './lib/store';
import Layout from './components/Layout';
import { Spinner, cx } from './components/ui';
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Projects = lazy(() => import('./pages/Projects'));
const Tickets = lazy(() => import('./pages/Tickets'));
const Clients = lazy(() => import('./pages/Clients'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Finance = lazy(() => import('./pages/Finance'));
const Settings = lazy(() => import('./pages/Settings'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Reports = lazy(() => import('./pages/Reports'));
const Assets = lazy(() => import('./pages/Assets'));
const Kb = lazy(() => import('./pages/Kb'));
const ClientReport = lazy(() => import('./pages/ClientReport'));
const Portal = lazy(() => import('./pages/Portal'));
import Hub from './components/Hub';

// Старые адреса разделов → новые (сохраняем ?open=… и прочие параметры)
function Moved({ to }) {
  const { search } = useLocation();
  const [path, q] = to.split('?');
  const params = new URLSearchParams(search);
  new URLSearchParams(q || '').forEach((v, k) => params.set(k, v));
  const s = params.toString();
  return <Navigate to={`${path}${s ? `?${s}` : ''}`} replace />;
}

const FINANCE = [
  { value: 'invoices', label: 'Счета', icon: Receipt, element: <Invoices /> },
  { value: 'operations', label: 'Доходы и расходы', icon: Wallet, element: <Finance /> },
  { value: 'reports', label: 'Отчёты', icon: BarChart3, element: <Reports /> },
];
const INFRA = [
  { value: 'assets', label: 'Оборудование', icon: Monitor, element: <Assets /> },
  { value: 'kb', label: 'База знаний', icon: BookOpen, element: <Kb /> },
];

function Gate() {
  const { user, isManager } = useApp();
  if (user === undefined) return <div className="h-full flex items-center justify-center"><Spinner /></div>;
  if (!user) return <Login />;
  if (user.portal) return (
    <Routes>
      <Route path="report/client" element={<ClientReport portal />} />
      <Route path="*" element={<Portal />} />
    </Routes>
  );
  return (
    <Routes>
      {isManager && <Route path="report/client" element={<ClientReport />} />}
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="infra/:tab?" element={<Hub title="ИТ-инфраструктура" base="/infra" tabs={INFRA} />} />
        <Route path="clients" element={<Clients />} />
        <Route path="pipeline" element={<Pipeline />} />
        {isManager && <Route path="finance/:tab?" element={<Hub title="Финансы" base="/finance" tabs={FINANCE} />} />}
        <Route path="settings/:tab?" element={<Settings />} />
        {/* старые адреса */}
        <Route path="calendar" element={<Moved to="/projects?view=calendar" />} />
        <Route path="time" element={<Moved to="/projects?view=time" />} />
        <Route path="assets" element={<Moved to="/infra/assets" />} />
        <Route path="kb" element={<Moved to="/infra/kb" />} />
        <Route path="team" element={<Moved to="/settings/team" />} />
        <Route path="catalog" element={<Moved to="/settings/catalog" />} />
        <Route path="invoices" element={<Moved to="/finance/invoices" />} />
        <Route path="reports" element={<Moved to="/finance/reports" />} />
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
        <Suspense fallback={<div className="h-full flex items-center justify-center"><Spinner /></div>}><Gate /></Suspense>
        <Toasts />
      </BrowserRouter>
    </AppProvider>
  );
}
