// 표시 포맷 헬퍼
import { RISK_COLORS, type RiskGrade } from "./types";

export function gradeColor(g: RiskGrade): string {
  return RISK_COLORS[g];
}

export function gradeChipClass(g: RiskGrade): string {
  return `chip chip-${g}`;
}

const GRADE_ORDER: RiskGrade[] = ["관심", "주의", "경계", "심각"];
export function gradeRank(g: RiskGrade): number {
  return GRADE_ORDER.indexOf(g);
}

// ISO(yyyy-mm-dd 월요일) → "8/4"
export function weekLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

// 주간 범위 "8/4~8/10"
export function weekRangeLabel(iso: string): string {
  const start = new Date(iso + "T00:00:00");
  const end = new Date(start.getTime() + 6 * 86400000);
  return `${start.getMonth() + 1}/${start.getDate()}~${end.getMonth() + 1}/${end.getDate()}`;
}

// "2025년 8월 1주" 형태
export function weekLongLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const weekOfMonth = Math.ceil(d.getDate() / 7);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${weekOfMonth}주`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function distLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

export const ALERT_LABEL: Record<string, string> = {
  없음: "특보 없음",
  주의보: "폭염주의보",
  경보: "폭염경보",
};
