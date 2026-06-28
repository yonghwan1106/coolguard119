// 클라이언트 라이브 데이터 페처 — 실패 시 degraded 폴백을 반환(절대 throw 안 함)
import type { LiveHeatAlert, LiveAirQuality } from "./types";

export async function fetchHeatAlert(pilot: string): Promise<LiveHeatAlert> {
  try {
    const res = await fetch(`/api/heat-alert?pilot=${encodeURIComponent(pilot)}`, { cache: "no-store" });
    if (!res.ok) throw new Error();
    return (await res.json()) as LiveHeatAlert;
  } catch {
    return { source: "fallback", fetchedAt: new Date().toISOString(), degraded: true, regions: [] };
  }
}

export async function fetchAirQuality(pilot: string): Promise<LiveAirQuality> {
  try {
    const res = await fetch(`/api/air-quality?pilot=${encodeURIComponent(pilot)}`, { cache: "no-store" });
    if (!res.ok) throw new Error();
    return (await res.json()) as LiveAirQuality;
  } catch {
    return { source: "fallback", fetchedAt: new Date().toISOString(), degraded: true, regions: [] };
  }
}
