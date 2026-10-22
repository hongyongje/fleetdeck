import { useEffect, useState } from 'react';
import { api, ago, clock, type Stats, type EventRow, type Device } from '../api.ts';
import { LineChart } from '../components/Chart.tsx';

export const KIND: Record<string, string> = { alert: '경보', resolve: '해제', online: '연결', register: '등록', update: '업데이트', 'update-fail': '실패', rollout: '배포', package: '패키지', security: '보안' };

export function Dashboard({ tick }: { tick: number }) {
  const [s, setS] = useState<Stats | null>(null);
  const [ev, setEv] = useState<EventRow[]>([]);
  const [devs, setDevs] = useState<Device[]>([]);
  useEffect(() => { api<Stats>('/api/stats').then(setS); api<EventRow[]>('/api/events').then(setEv); api<Device[]>('/api/devices').then(setDevs); }, [tick]);
  if (!s) return null;
  const crit = s.openAlerts.find((a) => a.severity === 'critical')?.n ?? 0;
  const warn = s.openAlerts.find((a) => a.severity === 'warning')?.n ?? 0;
  const job = (k: string) => s.jobs.find((j) => j.status === k)?.n ?? 0;
  const sites = [...new Set(devs.map((d) => d.site))];
  return (
    <>
      <header><h2>대시보드</h2><span className="muted">10분 기준 · 실시간 갱신</span></header>
      <div className="kpis">
        <div className="kpi"><small>전체 기기</small><b>{s.total}</b><span className="muted">{sites.length}개 현장</span></div>
        <div className="kpi ok"><small>온라인</small><b>{s.online}</b><span className="muted">가동률 {s.total ? Math.round((s.online / s.total) * 100) : 0}%</span></div>
        <div className="kpi bad"><small>긴급 경보</small><b>{crit}</b><span className="muted">주의 {warn}건</span></div>
        <div className="kpi"><small>업데이트</small><b>{job('done')}<em>/{job('done') + job('failed') + job('pending') + job('delivered') + job('installing')}</em></b><span className="muted">실패 {job('failed')} · 진행 {job('pending') + job('delivered') + job('installing')}</span></div>
      </div>
      <div className="grid2">
        <section className="card">
          <h3>현장 평균 온도 · CPU</h3>
          <LineChart series={[{ values: s.tempSeries.map((p) => p.temp), color: '#f97316', label: '평균 온도 (°C)' }, { values: s.tempSeries.map((p) => p.cpu), color: '#38bdf8', label: '평균 CPU (%)' }]} min={0} max={100} thresholds={[{ value: 60, color: '#facc15', label: '온도 주의 60°C' }]} />
        </section>
        <section className="card">
          <h3>현장별 상태</h3>
          <table><thead><tr><th>현장</th><th>기기</th><th>온라인</th><th>경보</th></tr></thead><tbody>
            {sites.map((site) => { const ds = devs.filter((d) => d.site === site); return (
              <tr key={site}><td>{site}</td><td>{ds.length}</td><td>{ds.filter((d) => d.online).length}</td><td>{ds.reduce((a, d) => a + d.alerts, 0) ? <span className="pill bad">{ds.reduce((a, d) => a + d.alerts, 0)}</span> : <span className="pill ok">정상</span>}</td></tr>); })}
          </tbody></table>
        </section>
      </div>
      <section className="card">
        <h3>최근 이벤트</h3>
        <ul className="timeline">{ev.slice(0, 12).map((e) => (
          <li key={e.id}><time>{clock(e.ts)}</time><span className={`tag ${e.kind}`}>{KIND[e.kind] ?? e.kind}</span>{e.message}<span className="muted"> · {ago(e.ts)}</span></li>
        ))}</ul>
      </section>
    </>
  );
}
