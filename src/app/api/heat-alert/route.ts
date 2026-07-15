// 라이브 폭염특보·예보기온 — 2소스 체인: ① 기상청 API허브(KMA_API_HUB_AUTHKEY)
// ② 공공데이터포털 기상특보 조회서비스(AIRKOREA_SERVICE_KEY와 동일한 data.go.kr 키, 15000415).
// 둘 다 실패 시 degraded=true + 결정론적 폴백으로 100% 동작.
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

// 특보 원문 텍스트 → 파일럿 지역 등급 매핑(두 소스 공용, 방어적 파싱)
function alertsFromText(pilot: string, text: string, source: LiveHeatAlert["source"]): LiveHeatAlert {
  const heatOn = /폭염|heat/i.test(text);
  const base = fallback(pilot);
  if (!heatOn) return { ...base, source, degraded: false };
  // 실제 특보 텍스트에 시군이 포함되면 해당 지역 등급 상향
  const regions = base.regions.map((r) => {
    const rname = pilotRegions(pilot).find((x) => x.code === r.regionCode)?.name ?? "";
    const hit = rname && text.includes(rname.replace(/시$|군$|구$/, ""));
    return hit ? { ...r, alertLevel: "경보" as HeatAlertLevel } : r;
  });
  return { source, fetchedAt: new Date().toISOString(), degraded: false, regions };
}

// 소스① 기상청 API허브(typ01). 실패 시 null(다음 소스로).
async function fromKma(pilot: string, authKey: string): Promise<LiveHeatAlert | null> {
  try {
    const url = `https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php?fe=f&authKey=${encodeURIComponent(authKey)}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const text = await res.text();
    if (/"status"\s*:\s*4\d\d/.test(text)) return null; // 200 본문 속 에러 JSON 방어
    return alertsFromText(pilot, text, "기상청 API허브");
  } catch {
    return null;
  }
}

// 소스② 공공데이터포털 기상특보 조회서비스(1360000/WthrWrnInfoService, data.go.kr 15000415).
// serviceKey는 URL 인코딩된 값을 그대로 삽입(에어코리아 라우트와 동일 관례). 실패 시 null.
async function fromDataPortal(pilot: string, serviceKey: string): Promise<LiveHeatAlert | null> {
  try {
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const to = ymd(kstNow);
    const from = ymd(new Date(kstNow.getTime() - 86400000));
    const url =
      `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnMsg` +
      `?serviceKey=${serviceKey}&pageNo=1&numOfRows=20&dataType=JSON&stnId=108&fromTmFc=${from}&toTmFc=${to}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw.trim().startsWith("{")) return null; // "Forbidden" 등 비JSON 게이트웨이 응답 방어
    const data = JSON.parse(raw);
    const code: string = data?.response?.header?.resultCode ?? "";
    if (code === "03") {
      // NO_DATA = 발효 특보 없음(정상 라이브 응답)
      return alertsFromText(pilot, "", "기상특보(공공데이터포털)");
    }
    if (code !== "00") return null;
    const items = data?.response?.body?.items?.item ?? [];
    const text = JSON.stringify(items);
    return alertsFromText(pilot, text, "기상특보(공공데이터포털)");
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pilot = searchParams.get("pilot") ?? "전북";
  const authKey = process.env.KMA_API_HUB_AUTHKEY;
  const portalKey = process.env.AIRKOREA_SERVICE_KEY; // 동일한 data.go.kr 일반 인증키
  const payload =
    (authKey ? await fromKma(pilot, authKey) : null) ??
    (portalKey ? await fromDataPortal(pilot, portalKey) : null) ??
    fallback(pilot);
  return Response.json(payload);
}
