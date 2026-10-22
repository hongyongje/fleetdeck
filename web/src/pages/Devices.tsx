import { useEffect, useState } from 'react';
import { api, ago, type Device } from '../api.ts';

export function Devices({ tick }: { tick: number }) {
  const [devs, setDevs] = useState<Device[]>([]);
  const [q, setQ] = useState(''); const [only, setOnly] = useState<'all' | 'alert' | 'offline'>('all');
  useEffect(() => { api<Device[]>('/api/devices').then(setDevs); }, [tick]);
  const shown = devs.filter((d) => (d.name + d.serial + d.site + d.model).toLowerCase().includes(q.toLowerCase()))
    .filter((d) => only === 'all' || (only === 'alert' ? d.alerts > 0 : !d.online));
  return (
    <>
      <header><h2>기기</h2><span className="muted">{devs.length}대 · 온라인 {devs.filter((d) => d.online).length}</span></header>
      <div className="toolbar">
        <input placeholder="이름, 시리얼, 현장 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {(['all', 'alert', 'offline'] as const).map((k) => <button key={k} className={only === k ? 'chip on' : 'chip'} onClick={() => setOnly(k)}>{{ all: '전체', alert: '경보 있음', offline: '오프라인' }[k]}</button>)}
      </div>
      <section className="card flush">
        <table className="devices"><thead><tr><th>상태</th><th>이름</th><th>모델</th><th>현장</th><th>펌웨어</th><th>온도</th><th>CPU</th><th>전력</th><th>경보</th><th>마지막 보고</th></tr></thead><tbody>
          {shown.map((d) => (
            <tr key={d.id} onClick={() => (location.hash = `#/device/${d.id}`)}>
              <td><span className={`dot ${d.online ? 'on' : 'off'}`} />{d.online ? '온라인' : '오프라인'}</td>
              <td><b>{d.name}</b><br /><small className="muted">{d.serial}</small></td>
              <td>{d.model}</td><td>{d.site}</td><td><code>{d.fw}</code></td>
              <td className={d.temp != null && d.temp >= 60 ? (d.temp >= 70 ? 'crit' : 'warn') : ''}>{d.temp != null ? `${d.temp.toFixed(1)}°C` : '-'}</td>
              <td className={d.cpu != null && d.cpu >= 90 ? 'warn' : ''}>{d.cpu != null ? `${d.cpu.toFixed(0)}%` : '-'}</td>
              <td>{d.power != null ? `${d.power.toFixed(0)} W` : '-'}</td>
              <td>{d.alerts ? <span className="pill bad">{d.alerts}</span> : <span className="muted">-</span>}</td>
              <td className="muted">{ago(d.last_seen)}</td>
            </tr>))}
        </tbody></table>
      </section>
    </>
  );
}
