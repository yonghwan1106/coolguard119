// 클라이언트 파생 — 주차·특보가 바뀌면 선배치 권고·브리핑을 재계산(파이프라인 로직 미러)
import type { AdjustedForecast } from "./clientEngine";
import type { DeployRecommendation, Prebriefing, GapCell, Region } from "./types";

export function blindByRegion(gapCells: GapCell[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of gapCells) if (c.isBlindSpot) m[c.regionCode] = (m[c.regionCode] ?? 0) + 1;
  return m;
}

export function buildDeployRecs(
  adjusted: AdjustedForecast[],
  regionByCode: Map<string, Region>,
  blind: Record<string, number>
): DeployRecommendation[] {
  const recs = adjusted.map((a) => {
    const r = regionByCode.get(a.regionCode);
    const surge = Math.round((a.expectedDemand - a.baseline) * 10) / 10;
    const b = blind[a.regionCode] ?? 0;
    let action: string;
    if ((a.grade === "경계" || a.grade === "심각") && a.expectedDemand >= 5)
      action = "구급차 선배치 + 쉼터 개방시간 연장(수요 급증 권역)";
    else if (a.grade === "경계" || a.grade === "심각")
      action = "취약 우선동 선제 안부 + 쉼터 공백지대 보강(고령 취약·쉼터 원거리)";
    else if (a.grade === "주의") action = "쉼터 운영 점검 + 공백지대 모니터링";
    else action = "평시 모니터링";
    return {
      regionCode: a.regionCode,
      regionName: r?.name ?? a.regionCode,
      grade: a.grade,
      expectedDemand: a.expectedDemand,
      baseline: a.baseline,
      surge,
      blindSpots: b,
      action,
      priority: Math.round((a.score * 100 + Math.max(0, surge) * 8 + b * 2) * 10) / 10,
    };
  });
  recs.sort((x, y) => y.priority - x.priority);
  return recs;
}

export function buildBriefing(a: AdjustedForecast, region: Region): Prebriefing {
  const deltaPct = Math.round(((a.expectedDemand - a.baseline) / Math.max(0.1, a.baseline)) * 100);
  const headline = `[${region.name}] ${a.weekStart} 주간 온열 구급수요 '${a.grade}'`;
  const body =
    `예측 ${a.expectedDemand}건(평년 ${a.baseline}건 대비 ${deltaPct >= 0 ? "+" : ""}${deltaPct}%). ` +
    `고령 취약 노출 ${Math.round(a.components.elderlyIndex * 100)}p, 기온/특보 요인 ${Math.round(a.tempIndex * 100)}p.`;
  const bullets: string[] = [];
  if (a.grade === "경계" || a.grade === "심각") {
    bullets.push("구급차 선배치 및 쉼터 개방시간 연장 검토");
    bullets.push("취약 우선동 대상 선제 안부·예방 안내");
  } else if (a.grade === "주의") {
    bullets.push("쉼터 운영 점검 및 공백지대 우선 보강");
  } else {
    bullets.push("평시 모니터링 유지");
  }
  bullets.push("쉼터 공백지대(출동밀도高·쉼터距離遠) 신규 입지 후보 검토");
  return { regionCode: a.regionCode, weekStart: a.weekStart, grade: a.grade, headline, body, bullets };
}
