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
  // 기본 표시 스코프 = 취약도 랭킹(vuln) — 검증 강한 지표를 먼저 보여준다(온열 주간은 드롭다운에서 선택)
  const [btScope, setBtScope] = useState<string>("vuln:전북");
  const [liveHeat, setLiveHeat] = useState<LiveHeatAlert | null>(null);
  const [liveAir, setLiveAir] = useState<LiveAirQuality | null>(null);

  // 전역 룩업
  const regionByCode = useMemo(() => new Map(bundle.regions.map((r) => [r.code, r])), [bundle.regions]);
  const rawForecasts = bundle.forecasts as unknown as RawForecast[];

  // 파일럿별 데이터 소스(전북 sample + 서울 real 혼합) — 배지가 '현재 보는 권역'의 소스를 표시
  const sourceByPilot = bundle.meta.sourceByPilot;
  const pilotSource: "real" | "sample" = sourceByPilot?.[pilot] ?? (bundle.dataSource === "mixed" ? "sample" : bundle.dataSource);
  const srcLabel = (s: "real" | "sample") => (s === "real" ? "실데이터(bigdata-119)" : "대체셋(sample)");
  const sourceTitle = sourceByPilot
    ? `전북: ${srcLabel(sourceByPilot["전북"])} · 서울: ${srcLabel(sourceByPilot["서울"])} — 현재 보기: ${pilot}(${pilotSource})`
    : "dataSource";
  const natl = bundle.meta.nationalContext;

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

  // 백테스팅(권역별 필터) — overall/vuln 등 `:${pilot}` 태그 스코프 + 생활권 코드 스코프 포함
  const btMetrics = useMemo(
    () => bundle.backtest.filter((m) => m.scope.endsWith(`:${pilot}`) || pilotCodes.has(m.scope)),
    [bundle.backtest, pilot, pilotCodes]
  );

  // pilot 변경 → 선택 초기화·라이브 재호출·백테스트 스코프·주차 보정
  useEffect(() => {
    setSelected(null);
    setBtScope(`vuln:${pilot}`);
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
        dataSource={pilotSource}
        dataSourceTitle={sourceTitle}
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
            {/* 특보는 수동 오버라이드든 기본값이든 종형곡선 합성 시나리오 — 항상 표기 */}
            <span className="text-[10px] mute2">{alertOverride ? "(시뮬레이션)" : "(시나리오)"}</span>
          </div>
          {pilotSource === "sample" ? (
            <div className="absolute bottom-3 left-3 panel-soft px-2.5 py-1.5 text-[10px] mute2 max-w-[260px]">
              ※ {pilot} 파일럿은 공개통계 기반 대체셋. bigdata-119 실CSV 적용 시 동일 화면이 실데이터로 전환됩니다.
            </div>
          ) : pilot === "전북" ? (
            <div className="absolute bottom-3 left-3 panel-soft px-2.5 py-1.5 text-[10px] mute2 max-w-[300px]">
              ● 전북 파일럿 = 실데이터. 출동점은 온열 구급출동 <b>실좌표</b>(2017~2022 여름 15주 창, 소수 3자리 스냅). 쉼터·공백지대 최근접거리는 합성 쉼터 표본 기반 근사(추정).
            </div>
          ) : (
            <div className="absolute bottom-3 left-3 panel-soft px-2.5 py-1.5 text-[10px] mute2 max-w-[300px]">
              ● 서울 파일럿 = 실데이터(검증). 원자료에 좌표가 없어 출동점은 자치구 단위 실건수의 <b>시각화용 근사배치</b>(집계 수치는 실측).
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
          {natl && (
            <div className="panel-soft px-2.5 py-2 text-[11px] leading-relaxed">
              <span className="font-semibold" style={{ color: "var(--accent-2)" }}>전국 컨텍스트</span>{" "}
              <span className="mute2">소방청 일일상황보고</span> · 폭염기(7~8월) 전국 구급출동{" "}
              <b>{natl.summerSurgeMultiplier}배</b>
              <span className="mute2"> (일평균 {Math.round(natl.peakDailyEms)} vs 평시 {Math.round(natl.restDailyEms)}건)</span>.{" "}
              <span className="mute2">온열 특정 폭증이 아닌 &lsquo;구급 전반 수요 증가&rsquo; 근거.</span>
            </div>
          )}
          <div className="text-[10px] mute2 px-1 leading-relaxed">
            데이터 출처: {bundle.meta.sources[0]} 외. 개인정보 미사용(우선동=집계). 쉼터 위치는 합성 표본(실좌표 데이터 연동 예정).
          </div>
        </aside>
      </div>
    </div>
  );
}
