// Alert rules. Pure functions so they can be unit-tested without a server.

export type Severity = 'warning' | 'critical';
export interface Sample { ts: number; cpu: number; mem: number; temp: number; humidity: number; power: number }
export interface RuleResult { rule: string; severity: Severity; message: string }

export const THRESHOLDS = {
  tempWarn: 60,
  tempCrit: 70,
  cpuHigh: 90,
  cpuHighSamples: 3,
  offlineMs: 30_000,
};

/** Evaluate the latest samples (newest last). Returns the rules that are currently firing. */
export function evaluate(samples: Sample[]): RuleResult[] {
  const out: RuleResult[] = [];
  const last = samples[samples.length - 1];
  if (!last) return out;
  if (last.temp >= THRESHOLDS.tempCrit) out.push({ rule: 'temp', severity: 'critical', message: `온도 ${last.temp.toFixed(1)}°C (기준 ${THRESHOLDS.tempCrit}°C)` });
  else if (last.temp >= THRESHOLDS.tempWarn) out.push({ rule: 'temp', severity: 'warning', message: `온도 ${last.temp.toFixed(1)}°C (기준 ${THRESHOLDS.tempWarn}°C)` });
  const recent = samples.slice(-THRESHOLDS.cpuHighSamples);
  if (recent.length === THRESHOLDS.cpuHighSamples && recent.every((s) => s.cpu >= THRESHOLDS.cpuHigh)) {
    out.push({ rule: 'cpu', severity: 'warning', message: `CPU ${last.cpu.toFixed(0)}% 연속 ${THRESHOLDS.cpuHighSamples}회` });
  }
  return out;
}

export function isOffline(lastSeen: number | null, now: number): boolean {
  return lastSeen == null || now - lastSeen > THRESHOLDS.offlineMs;
}
