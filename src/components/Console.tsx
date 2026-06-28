"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { DataBundle, Region, HeatAlertLevel, LiveHeatAlert, LiveAirQuality } from "@/lib/types";
import type { RawForecast } from "@/lib/clientEngine";
import { recompute, recomputeWeek } from "@/lib/clientEngine";
import { blindByRegion, buildDeployRecs, buildBriefing } from "@/lib/derive";
import { Header } from "./Header";
import { ControlBar, type Layers } from "./ControlBar";
import {
  DeployPanel,
  RegionDetailPanel,
  PriorityDongPanel,
  BriefingPanel,
  BacktestPanel,
  OverallSummary,
} from "./SidePanels";
import { weekLongLabel, ALERT_LABEL } from "@/lib/format";

const MapConsole = dynamic(() => import("./MapConsole"), { ssr: false });

export default function Console({ bundle }: { bundle: DataBundle }) {
  const weeks = bundle.meta.weeks;
  const defaultIdx = Math.max(0, weeks.indexOf((bundle.meta as { defaultWeek?: string }).defaultWeek ?? weeks[0]));

  const [pilot, setPilot] = useState<"전북" | "서울">("전북");
  const [weekIndex, setWeekIndex] = useState(defaultIdx);
  const [alertOverride, setAlertOverride] = useState<HeatAlertLevel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ gap: true, shelters: false, incidents: false });
  const [playing, setPlaying] = useState(false);
  const [btScope, setBtScope] = useState<string>("overall:전북");
  const [liveHeat, setLiveHeat] = useState<LiveHeatAlert | null>(null);
  const [liveAir, setLiveAir] = useState<LiveAirQuality | null>(null);

  // 전역 룩업
  const regionByCode = useMemo(() => new Map(bundle.regions.map((r) => [r.code, r])), [bundle.regions]);
  const rawForecasts = bundle.forecasts as unknown as RawForecast[];

  // 권역 필터
  const pilotRegions = useMemo<Region[]>(
    () => bundle.regions.filter((r) => (pilot === "서울" ? r.sido.includes("서울") : r.sido.includes("전북"))),
    [bundle.regions, pilot]
  );
  const pilotCodes = useMemo(() => new Set(pilotRegions.map((r) => r.code)), [pilotRegions]);
  const pilotForecasts = useMemo(() => rawForecasts.filter((f) => pilotCodes.has(f.regionCode)), [rawForecasts, pilotCodes]);
  const pilotShelters = useMemo(() => bundle.shelters.filter((s) => pilotCodes.has(s.regionCode)), [bundle.shelters, pilotCodes]);
  const pilotGap = useMemo(() => bundle.gapCells.filter((c) => pilotCodes.has(c.regionCode)), [bundle.gapCells, pilotCodes]);
  const pilotIncidents = useMemo(
    () => bundle.incidents.filter((i) => pilotCodes.has(i.regionCode)),
    [bundle.incidents, pilotCodes]
  );

  const week = weeks[weekIndex];
  const scenarioAlert: HeatAlertLevel = pilotForecasts.find((f) => f.weekStart === week)?.scenarioAlert ?? "없음";

  // 현재 주·특보 기준 재계산
  const adjusted = useMemo(
    () => recomputeWeek(pilotForecasts, week, alertOverride),
    [pilotForecasts, week, alertOverride]
  );
  const adjByCode = useMemo(() => new Map(adjusted.map((a) => [a.regionCode, a])), [adjusted]);
  const blind = useMemo(() => blindByRegion(pilotGap), [pilotGap]);
  const deployRecs = useMemo(() => buildDeployRecs(adjusted, regionByCode, blind), [adjusted, regionByCode, blind]);

  // 선택 권역 파생
  const selRegion = selected ? regionByCode.get(selected) ?? null : null;
  const selForecast = selected ? adjByCode.get(selected) ?? null : null;
  const weekSeries = useMemo(() => {
    if (!selected) return [];
    const byWeek = new Map(pilotForecasts.filter((f) => f.regionCode === selected).map((f) => [f.weekStart, f]));
    return weeks.map((w) => {
      const f = byWeek.get(w);
      return f ? recompute(f, alertOverride).expectedDemand : 0;
    });
  }, [selected, pilotForecasts, weeks, alertOverride]);
  const selDongs = useMemo(
    () => (selected ? bundle.priorityDongs.filter((d) => d.regionCode === selected) : []),
    [selected, bundle.priorityDongs]
  );
  const selAir = useMemo(() => liveAir?.regions.find((r) => r.regionCode === selected) ?? null, [liveAir, selected]);
  const briefing = useMemo(() => {
    const code = selected ?? deployRecs[0]?.regionCode;
    if (!code) return null;
    const a = adjByCode.get(code);
    const r = regionByCode.get(code);
    return a && r ? buildBriefing(a, r) : null;
  }, [selected, deployRecs, adjByCode, regionByCode]);

  // 백테스팅(권역별 필터)
  const btMetrics = useMemo(
    () => bundle.backtest.filter((m) => m.scope === `overall:${pilot}` || pilotCodes.has(m.scope)),
    [bundle.backtest, pilot, pilotCodes]
  );

  // pilot 변경 → 선택 초기화·라이브 재호출·백테스트 스코프·주차 보정
  useEffect(() => {
    setSelected(null);
    setBtScope(`overall:${pilot}`);
    let alive = true;
    import("@/lib/live").then(async ({ fetchHeatAlert, fetchAirQuality }) => {
      const [h, a] = await Promise.all([fetchHeatAlert(pilot), fetchAirQuality(pilot)]);
      if (alive) {
        setLiveHeat(h);
        setLiveAir(a);
      }
    });
    return () => {
      alive = false;
    };
  }, [pilot]);

  // 선택 권역의 백테스트로 스코프 전환
  useEffect(() => {
    if (selected && btMetrics.some((m) => m.scope === selected)) setBtScope(selected);
  }, [selected, btMetrics]);

  // 자동 재생
  const playRef = useRef(playing);
  playRef.current = playing;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setWeekIndex((i) => (i + 1) % weeks.length), 1100);
    return () => clearInterval(t);
  }, [playing, weeks.length]);

  const degraded = (liveHeat?.degraded ?? true) || (liveAir?.degraded ?? true);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        dataSource={bundle.dataSource}
        generatedAt={bundle.generatedAt}
        heatSource={liveHeat?.source ?? "fallback"}
        airSource={liveAir?.source ?? "fallback"}
        degraded={degraded}
      />
      <div className="flex flex-1 min-h-0">
        {/* 좌측 */}
        <aside className="w-[340px] shrink-0 overflow-y-auto p-3 space-y-3 border-r" style={{ borderColor: "var(--line)", background: "var(--bg-soft)" }}>
          <ControlBar
            pilot={pilot}
            onPilot={setPilot}
            weeks={weeks}
            weekIndex={weekIndex}
            onWeekIndex={setWeekIndex}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            alertOverride={alertOverride}
            scenarioAlert={scenarioAlert}
            onAlert={setAlertOverride}
            layers={layers}
            onLayers={setLayers}
          />
          <DeployPanel recs={deployRecs} selected={selected} onSelect={setSelected} />
        </aside>

        {/* 중앙 지도 */}
        <main className="relative flex-1 min-w-0">
          <MapConsole
            pilot={pilot}
            regions={pilotRegions}
            adjusted={adjusted}
            shelters={pilotShelters}
            gapCells={pilotGap}
            incidents={pilotIncidents}
            selectedRegion={selected}
            onSelectRegion={setSelected}
            layers={layers}
          />
          {/* 상단 주차 칩 */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 panel px-3 py-1.5 text-[12px] font-semibold flex items-center gap-2 pointer-events-none">
            <span>{weekLongLabel(week)}</span>
            <span className="mute2">·</span>
            <span style={{ color: "var(--accent-2)" }}>{ALERT_LABEL[alertOverride ?? scenarioAlert]}</span>
            {alertOverride && <span className="text-[10px] mute2">(시뮬레이션)</span>}
          </div>
          {bundle.dataSource === "sample" && (
            <div className="absolute bottom-3 left-3 panel-soft px-2.5 py-1.5 text-[10px] mute2 max-w-[260px]">
              ※ 현재 공개통계 기반 대체셋. bigdata-119 실CSV 적용 시 동일 화면이 실데이터로 전환됩니다.
            </div>
          )}
        </main>

        {/* 우측 */}
        <aside className="w-[372px] shrink-0 overflow-y-auto p-3 space-y-3 border-l" style={{ borderColor: "var(--line)", background: "var(--bg-soft)" }}>
          {selRegion && selForecast ? (
            <RegionDetailPanel region={selRegion} forecast={selForecast} weekSeries={weekSeries} air={selAir} />
          ) : (
            <OverallSummary adjusted={adjusted} weekLabel={weekLongLabel(week)} alertLabel={ALERT_LABEL[alertOverride ?? scenarioAlert]} />
          )}
          <BriefingPanel briefing={briefing} />
          {selRegion && <PriorityDongPanel regionName={selRegion.name} dongs={selDongs} />}
          <BacktestPanel metrics={btMetrics} scope={btScope} onScope={setBtScope} />
          <div className="text-[10px] mute2 px-1 leading-relaxed">
            데이터 출처: {bundle.meta.sources[0]} 외. 개인정보 미사용(우선동=집계). 쉼터는 운영시간 기반 추정.
          </div>
        </aside>
      </div>
    </div>
  );
}
