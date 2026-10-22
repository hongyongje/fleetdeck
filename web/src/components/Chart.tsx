// Tiny dependency-free SVG line chart.
interface Series { values: number[]; color: string; label: string }

export function LineChart({ series, height = 160, min, max, thresholds = [] }: { series: Series[]; height?: number; min?: number; max?: number; thresholds?: { value: number; color: string; label: string }[] }) {
  const w = 600; const h = height; const pad = 24;
  const all = series.flatMap((s) => s.values).concat(thresholds.map((t) => t.value));
  const lo = min ?? Math.floor(Math.min(...all, 0)); const hi = max ?? Math.ceil(Math.max(...all, 1));
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${pad + (i / Math.max(1, vals.length - 1)) * (w - pad * 2)},${y(v)}`).join(' ');
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={w - pad} y1={pad + f * (h - pad * 2)} y2={pad + f * (h - pad * 2)} className="grid" />)}
        {thresholds.map((t) => <g key={t.label}><line x1={pad} x2={w - pad} y1={y(t.value)} y2={y(t.value)} stroke={t.color} strokeDasharray="5 5" strokeWidth={1.2} /><text x={w - pad} y={y(t.value) - 4} textAnchor="end" fill={t.color} fontSize={11}>{t.label}</text></g>)}
        {series.map((s) => s.values.length > 1 && <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" />)}
        <text x={4} y={pad + 4} className="axis">{hi}</text>
        <text x={4} y={h - pad + 4} className="axis">{lo}</text>
      </svg>
      <div className="legend">{series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}

export function Spark({ values, color = '#22c55e' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <span className="muted">-</span>;
  const lo = Math.min(...values), hi = Math.max(...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * 80},${22 - ((v - lo) / (hi - lo || 1)) * 20}`).join(' ');
  return <svg width={80} height={24}><path d={d} fill="none" stroke={color} strokeWidth={1.6} /></svg>;
}
