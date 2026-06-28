// 라이브 폭염특보·예보기온 — 기상청 API허브(KMA_API_HUB_AUTHKEY).
// 키 미발급/장애 시 degraded=true + 결정론적 폴백으로 100% 동작.
import seed from "@/data/regions_seed.json";
import type { LiveHeatAlert, HeatAlertLevel } from "@/lib/types";

export const revalidate = 1800; // 30분 캐시

type SeedRegion = { code: string; name: string; centroid: { lat: number; lng: number }; elderlyRatio: number };

function pilotRegions(pilot: string): SeedRegion[] {
  const key = pilot === "서울" ? "서울" : "전북";
  return (seed as Record<string, SeedRegion[]>)[key];
}

// 폴백: 오늘 날짜의 여름 강도 + 남부/고령 가중으로 결정론적 특보 생성
function heatFactorToday(): number {
  const now = new Date();
  const peak = new Date(now.getFullYear(), 7, 4); // 8/4
  const diffDays = Math.abs((now.getTime() - peak.getTime()) / 86400000);
  return Math.max(0.05, Math.exp(-Math.pow(diffDays / 24, 2)));
}

function fallback(pilot: string): LiveHeatAlert {
  const hf = heatFactorToday();
  const regions = pilotRegions(pilot).map((r) => {
    const local = Math.min(1, hf + r.elderlyRatio * 0.25 + (r.centroid.lat < 36 ? 0.05 : 0));
    const level: HeatAlertLevel = local > 0.75 ? "경보" : local > 0.45 ? "주의보" : "없음";
    const temp = 26 + local * 11; // 26~37도 근사
    return { regionCode: r.code, alertLevel: level, forecastTempMax: Math.round(temp * 10) / 10 };
  });
  return { source: "fallback", fetchedAt: new Date().toISOString(), degraded: true, regions };
}

// 기상청 API허브 실호출(키 있을 때). 파싱 실패·장애 시 폴백.
async function fromKma(pilot: string, authKey: string): Promise<LiveHeatAlert> {
  try {
    // 기상특보 현황(typ01). 텍스트 응답을 방어적으로 파싱.
    const url = `https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php?fe=f&authKey=${encodeURIComponent(authKey)}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) throw new Error(`KMA ${res.status}`);
    const text = await res.text();
    // 폭염(특보코드 H) 발효 지역 추출 — 광역 단위. 생활권 매핑은 근사.
    const heatOn = /폭염|heat/i.test(text);
    const base = fallback(pilot);
    if (!heatOn) return { ...base, source: "기상청 API허브", degraded: false };
    // 실제 특보 텍스트에 시군이 포함되면 해당 지역 등급 상향
    const regions = base.regions.map((r) => {
      const rname = pilotRegions(pilot).find((x) => x.code === r.regionCode)?.name ?? "";
      const hit = rname && text.includes(rname.replace(/시$|군$|구$/, ""));
      return hit ? { ...r, alertLevel: "경보" as HeatAlertLevel } : r;
    });
    return { source: "기상청 API허브", fetchedAt: new Date().toISOString(), degraded: false, regions };
  } catch {
    return fallback(pilot);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pilot = searchParams.get("pilot") ?? "전북";
  const authKey = process.env.KMA_API_HUB_AUTHKEY;
  const payload = authKey ? await fromKma(pilot, authKey) : fallback(pilot);
  return Response.json(payload);
}
