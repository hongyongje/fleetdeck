import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { me, logout, stream } from './api.ts';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Devices } from './pages/Devices.tsx';
import { DeviceView } from './pages/DeviceView.tsx';
import { Alerts } from './pages/Alerts.tsx';
import { Updates } from './pages/Updates.tsx';

export type Route = { page: 'dashboard' | 'devices' | 'device' | 'alerts' | 'updates'; id?: string };
const parse = (): Route => { const [page, id] = location.hash.replace('#/', '').split('/'); return { page: (page || 'dashboard') as Route['page'], id }; };

function App() {
  const [route, setRoute] = useState<Route>(parse());
  const [tick, setTick] = useState(0);           // bumps on every server push so pages refetch
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { const f = () => setRoute(parse()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    if (!me) return;
    let pending = false;
    return stream((type, data) => {
      if (type === 'alert' && data.severity === 'critical' && !data.resolved) { setToast(`긴급 경보 · ${data.message}`); setTimeout(() => setToast(null), 5000); }
      if (!pending) { pending = true; setTimeout(() => { pending = false; setTick((t) => t + 1); }, 1000); }
    });
  }, []);
  if (!me) return <Login />;
  const nav = (p: Route['page'], label: string, icon: string) => (
    <a href={`#/${p}`} className={route.page === p || (p === 'devices' && route.page === 'device') ? 'active' : ''}><span>{icon}</span>{label}</a>
  );
  return (
    <div className="layout">
      <aside>
        <div className="brand"><b>FleetDeck</b><small>기기 관제</small></div>
        <nav>{nav('dashboard', '대시보드', '◧')}{nav('devices', '기기', '▦')}{nav('alerts', '경보', '△')}{nav('updates', '원격 업데이트', '⇪')}</nav>
        <div className="me"><span className="live" />실시간 연결<br /><b>{me.user}</b> · {me.role}<button onClick={() => { logout(); location.reload(); }}>로그아웃</button></div>
      </aside>
      <main>
        {route.page === 'dashboard' && <Dashboard tick={tick} />}
        {route.page === 'devices' && <Devices tick={tick} />}
        {route.page === 'device' && route.id && <DeviceView id={route.id} tick={tick} />}
        {route.page === 'alerts' && <Alerts tick={tick} />}
        {route.page === 'updates' && <Updates tick={tick} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
