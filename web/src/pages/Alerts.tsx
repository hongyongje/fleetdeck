import { useEffect, useState } from 'react';
import { api, ago, me, type Alert } from '../api.ts';

const RULE: Record<string, string> = { temp: '온도', cpu: 'CPU', offline: '응답 없음' };

export function Alerts({ tick }: { tick: number }) {
  const [rows, setRows] = useState<Alert[]>([]);
  const [reload, setReload] = useState(0);
  useEffect(() => { api<Alert[]>('/api/alerts').then(setRows); }, [tick, reload]);
  const canAck = me?.role !== 'viewer';
  const open = rows.filter((a) => !a.resolved_at);
  return (
    <>
      <header><h2>경보</h2><span className="muted">진행 중 {open.length}건 · 같은 기기·같은 규칙은 한 건으로 묶고 값이 돌아오면 자동 해제</span></header>
      <section className="card flush">
        <table><thead><tr><th>심각도</th><th>기기</th><th>규칙</th><th>내용</th><th>발생</th><th>상태</th><th /></tr></thead><tbody>
          {rows.map((a) => (
            <tr key={a.id} className={a.resolved_at ? 'dim' : ''}>
              <td><span className={`pill ${a.severity === 'critical' ? 'bad' : 'warn'}`}>{a.severity === 'critical' ? '긴급' : '주의'}</span></td>
              <td><a href={`#/device/${a.device_id}`}>{a.device_name}</a></td>
              <td>{RULE[a.rule] ?? a.rule}</td><td>{a.message}</td><td className="muted">{ago(a.opened_at)}</td>
              <td>{a.resolved_at ? <span className="muted">해제 · {ago(a.resolved_at)}</span> : a.acked_by ? <span>확인함 ({a.acked_by})</span> : <b className="crit">미확인</b>}</td>
              <td>{!a.resolved_at && !a.acked_by && canAck && <button className="small" onClick={() => api(`/api/alerts/${a.id}/ack`, { method: 'POST' }).then(() => setReload((x) => x + 1))}>확인</button>}</td>
            </tr>))}
        </tbody></table>
      </section>
    </>
  );
}
