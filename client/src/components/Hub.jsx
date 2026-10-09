import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { HubContext } from './ui';

// Раздел с вкладками-страницами. tabs: [{ value, label, icon, element, hidden }]
// Адрес вкладки — `${base}/${value}`; старые адреса страниц перенаправляются сюда в App.jsx.
export default function Hub({ title, base, tabs }) {
  const { tab } = useParams();
  const nav = useNavigate();
  const visible = tabs.filter((t) => !t.hidden);
  const cur = visible.find((t) => t.value === tab);
  if (!cur) return <Navigate to={`${base}/${visible[0].value}${location.search}`} replace />;
  return (
    <HubContext.Provider value={{ title, tabs: visible.map(({ value, label, icon }) => ({ value, label, icon })), value: cur.value, onChange: (v) => nav(`${base}/${v}`) }}>
      <div key={cur.value}>{cur.element}</div>
    </HubContext.Provider>
  );
}
