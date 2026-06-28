// 클라이언트 예측 재계산 엔진 — pipeline/build_bundle.py 의 수식을 1:1 미러.
// 시뮬레이터에서 폭염특보를 토글하면 등급·예측을 실시간 재계산한다(서버 왕복 없음, 재현가능).
import type { WeeklyForecast, RiskGrade, HeatAlertLevel } from "./types";

// 예보 dict에 파이프라인이 추가로 실어준 필드
export interface RawForecast extends WeeklyForecast {
  baseTempIndex: number; // 특보 무관 기온지수(heat_week_factor)
  scenarioAlert: HeatAlertLevel; // 해당 주 기본 특보 시나리오
  _score?: number;
}

const ALERT_TEMP_DELTA: Record<HeatAlertLevel, number> = { 없음: 0, 주의보: 0.12, 경보: 0.25 };
const ALERT_DEMAND_MULT: Record<HeatAlertLevel, number> = { 없음: 0, 주의보: 0.15, 경보: 0.35 };
const W = { temp: 0.4, elderly: 0.24, exposure: 0.16, history: 0.2 };

export function gradeOf(score: number): RiskGrade {
  if (score >= 0.8) return "심각";
  if (score >= 0.6) return "경계";
  if (score >= 0.4) return "주의";
  return "관심";
}

export interface AdjustedForecast {
  regionCode: string;
  weekStart: string;
  grade: RiskGrade;
  score: number;
  expectedDemand: number;
  baseline: number;
  tempIndex: number;
  alert: HeatAlertLevel;
  components: WeeklyForecast["components"];
  confidence: number;
}

// alertOverride 가 null 이면 해당 주의 기본 시나리오 특보를 사용
export function recompute(f: RawForecast, alertOverride: HeatAlertLevel | null): AdjustedForecast {
  const alert = alertOverride ?? f.scenarioAlert;
  const tempIndex = Math.min(1, f.baseTempIndex + ALERT_TEMP_DELTA[alert]);
  const c = f.components;
  const score = Math.max(
    0,
    Math.min(1, W.temp * tempIndex + W.elderly * c.elderlyIndex + W.exposure * c.exposureIndex + W.history * c.historyIndex)
  );
  const demand = f.baseline * (0.85 + 0.6 * tempIndex) * (1 + ALERT_DEMAND_MULT[alert]);
  return {
    regionCode: f.regionCode,
    weekStart: f.weekStart,
    grade: gradeOf(score),
    score: Math.round(score * 1000) / 1000,
    expectedDemand: Math.round(demand * 10) / 10,
    baseline: f.baseline,
    tempIndex: Math.round(tempIndex * 1000) / 1000,
    alert,
    components: { ...c, tempIndex: Math.round(tempIndex * 1000) / 1000 },
    confidence: f.confidence,
  };
}

// 한 주의 전체 생활권 재계산
export function recomputeWeek(
  forecasts: RawForecast[],
  weekStart: string,
  alertOverride: HeatAlertLevel | null
): AdjustedForecast[] {
  return forecasts.filter((f) => f.weekStart === weekStart).map((f) => recompute(f, alertOverride));
}
