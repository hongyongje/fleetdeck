import { useEffect, useState } from 'react';
import { api, ago, clock, type DeviceDetail } from '../api.ts';
import { LineChart } from '../components/Chart.tsx';
import { KIND } from './Dashboard.tsx';

export function DeviceView({ id, tick }: { id: string; tick: number }) {
  const [d, setD] = useState<DeviceDetail | null>(null);
  useEffect(() => { api<DeviceDetail>(`/api/devices/${id}?minutes=15`).then(setD); }, [id, tick]);
  if (!d) return null;
  const last = d.series[d.series.length - 1];
  return (
    <>
      <header><a href="#/devices" className="back">← 기기</a><h2>{d.name}</h2><span className={`pill ${d.online ? 'ok' : 'bad'}`}>{d.online ? '온라인' : '오프라인'}</span></header>
      <div className="kpis">
        <div className="kpi"><small>온도</small><b>{last ? last.temp.toFixed(1) : '-'}<em>°C</em></b><span className="muted">습도 {last ? last.humidity.toFixed(0) : '-'}%</span></div>
        <div className="kpi"><small>CPU · 메모리</small><b>{last ? last.cpu.toFixed(0) : '-'}<em>%</em></b><span className="muted">메모리 {last ? last.mem.toFixed(0) : '-'}%</span></div>
        <div className="kpi"><small>전력</small><b>{last ? last.power.toFixed(0) : '-'}<em>W</em></b><span className="muted">{d.model}</span></div>
        <div className="kpi"><small>펌웨어</small><b className="mono">{d.fw}</b><span className="muted">마지막 보고 {ago(d.last_seen)}</span></div>
      </div>
      <div className="grid2">
        <section className="card"><h3>온도 · 습도 (15분)</h3>
          <LineChart series={[{ values: d.series.map((s) => s.temp), color: '#f97316', label: '온도 °C' }, { values: d.series.map((s) => s.humidity), color: '#a78bfa', label: '습도 %' }]} min={0} max={100}
            thresholds={[{ value: 70, color: '#ef4444', label: '긴급 70°C' }, { value: 60, color: '#facc15', label: '주의 60°C' }]} /></section>
        <section className="card"><h3>CPU · 전력 (15분)</h3>
          <LineChart series={[{ values: d.series.map((s) => s.cpu), color: '#38bdf8', label: 'CPU %' }, { values: d.series.map((s) => s.power / 2.5), color: '#22c55e', label: '전력 (W/2.5)' }]} min={0} max={100}
            thresholds={[{ value: 90, color: '#facc15', label: 'CPU 90%' }]} /></section>
      </div>
      <div className="grid2">
        <section className="card"><h3>기기 정보</h3>
          <dl><dt>시리얼</dt><dd>{d.serial}</dd><dt>현장</dt><dd>{d.site}</dd><dt>모델</dt><dd>{d.model}</dd><dt>등록</dt><dd>{new Date(d.created_at).toLocaleString('ko-KR')}</dd><dt>보고 방식</dt><dd>값이 바뀔 때 + 15초 하트비트</dd></dl>
        </section>
        <section className="card"><h3>이벤트</h3>
          <ul className="timeline">{d.events.slice(0, 8).map((e, i) => <li key={i}><time>{clock(e.ts)}</time><span className={`tag ${e.kind}`}>{KIND[e.kind] ?? e.kind}</span>{e.message}</li>)}</ul>
        </section>
      </div>
    </>
  );
}
