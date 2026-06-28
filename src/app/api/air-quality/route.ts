// 라이브 대기질(통합대기환경지수·PM) — 에어코리아(AIRKOREA_SERVICE_KEY, data.go.kr 15073861).
// 호흡취약 고령층 복합 위험 보조게이지(선택피처). 키 미발급/장애 시 degraded 폴백.
import seed from "@/data/regions_seed.json";
import type { LiveAirQuality } from "@/lib/types";

export const revalidate = 1800;

type SeedRegion = { code: string; name: string; sido: string };

function pilotRegions(pilot: string): SeedRegion[] {
  const key = pilot === "서울" ? "서울" : "전북";
  return (seed as Record<string, SeedRegion[]>)[key];
}

function khaiGrade(khai: number): string {
  if (khai <= 50) return "좋음";
  if (khai <= 100) return "보통";
  if (khai <= 250) return "나쁨";
  return "매우나쁨";
}

function fallback(pilot: string): LiveAirQuality {
  const regions = pilotRegions(pilot).map((r, i) => {
    const pm10 = 25 + ((i * 7) % 40);
    const pm25 = 12 + ((i * 5) % 25);
    const khai = 40 + ((i * 11) % 90);
    return { regionCode: r.code, pm10, pm25, khai, grade: khaiGrade(khai) };
  });
  return { source: "fallback", fetchedAt: new Date().toISOString(), degraded: true, regions };
}

async function fromAirkorea(pilot: string, serviceKey: string): Promise<LiveAirQuality> {
  try {
    const sido = pilot === "서울" ? "서울" : "전북";
    const url =
      `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` +
      `?serviceKey=${serviceKey}&returnType=json&numOfRows=200&pageNo=1&sidoName=${encodeURIComponent(sido)}&ver=1.3`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) throw new Error(`airkorea ${res.status}`);
    const data = await res.json();
    const items: Array<{ stationName?: string; pm10Value?: string; pm25Value?: string; khaiValue?: string; cityName?: string }> =
      data?.response?.body?.items ?? [];
    if (!items.length) throw new Error("empty");
    // 시군 이름 부분일치로 측정소 매핑, 없으면 시도 평균
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const toNum = (v?: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
    const regions = pilotRegions(pilot).map((r) => {
      const key = r.name.replace(/시$|군$|구$/, "");
      const match = items.filter((it) => (it.cityName ?? it.stationName ?? "").includes(key));
      const pool = match.length ? match : items;
      const pm10 = avg(pool.map((x) => toNum(x.pm10Value)).filter(Number.isFinite));
      const pm25 = avg(pool.map((x) => toNum(x.pm25Value)).filter(Number.isFinite));
      const khai = avg(pool.map((x) => toNum(x.khaiValue)).filter(Number.isFinite));
      return {
        regionCode: r.code,
        pm10: pm10 != null ? Math.round(pm10) : null,
        pm25: pm25 != null ? Math.round(pm25) : null,
        khai: khai != null ? Math.round(khai) : null,
        grade: khai != null ? khaiGrade(khai) : null,
      };
    });
    return { source: "에어코리아", fetchedAt: new Date().toISOString(), degraded: false, regions };
  } catch {
    return fallback(pilot);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pilot = searchParams.get("pilot") ?? "전북";
  const serviceKey = process.env.AIRKOREA_SERVICE_KEY;
  const payload = serviceKey ? await fromAirkorea(pilot, serviceKey) : fallback(pilot);
  return Response.json(payload);
}
