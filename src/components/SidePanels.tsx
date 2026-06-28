"use client";
import type { Region, PriorityDong, Prebriefing, BacktestMetric, RiskGrade, LiveAirQuality } from "@/lib/types";
import type { AdjustedForecast } from "@/lib/clientEngine";
import type { DeployRecommendation } from "@/lib/types";
import { RISK_COLORS } from "@/lib/types";
import { num, pct, gradeChipClass } from "@/lib/format";

export function GradeChip({ grade }: { grade: RiskGrade }) {
  return <span className={gradeChipClass(grade)}>{grade}</span>;
}

export function Sparkline({ values, color = "#ff7a4d", w = 132, h = 30 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / span) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 mute2 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[var(--panel-2)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="w-8 text-right muted tabular-nums">{Math.round(value * 100)}</span>
    </div>
  );
}

// ── 선배치 권고 ─────────────────────────────────────────────
export function DeployPanel({
  recs,
  selected,
  onSelect,
}: {
  recs: DeployRecommendation[];
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  const top = recs.slice(0, 7);
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold">선배치 권고 <span className="mute2 font-normal">우선순위</span></h3>
        <span className="text-[10px] mute2">예측수요·공백지대 가중</span>
      </div>
      <div className="space-y-1.5">
        {top.map((r) => (
          <button
            key={r.regionCode}
            onClick={() => onSelect(r.regionCode === selected ? null : r.regionCode)}
            className={`w-full text-left rounded-lg px-2.5 py-2 border transition ${
              r.regionCode === selected ? "border-[var(--accent)] bg-[var(--panel-2)]" : "border-[var(--line)] hover:bg-[var(--panel-2)]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[13px]">{r.regionName}</span>
              <GradeChip grade={r.grade} />
            </div>
            <div className="text-[11px] muted mt-1 flex gap-3">
              <span>예측 <b className="text-[var(--fg)]">{r.expectedDemand}</b>건</span>
              <span>평년比 <b className={r.surge > 0 ? "text-[var(--accent-2)]" : "muted"}>{r.surge > 0 ? "+" : ""}{r.surge}</b></span>
              <span>공백 <b className="text-[var(--fg)]">{r.blindSpots}</b>곳</span>
            </div>
            <div className="text-[11px] mt-1 text-[var(--fg-dim)] leading-snug">{r.action}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 생활권 상세 ─────────────────────────────────────────────
export function RegionDetailPanel({
  region,
  forecast,
  weekSeries,
  air,
}: {
  region: Region;
  forecast: AdjustedForecast;
  weekSeries: number[];
  air: LiveAirQuality["regions"][number] | null;
}) {
  const f = forecast;
  return (
    <div className="panel p-3 animate-fade">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold">{region.name}</h3>
          <div className="text-[11px] mute2">{region.sido} · 고령 {pct(region.elderlyRatio)} · 인구 {num(region.population)}</div>
        </div>
        <div className="text-right">
          <GradeChip grade={f.grade} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Stat label="예측 수요" value={`${f.expectedDemand}`} unit="건/주" accent />
        <Stat label="평년" value={`${f.baseline}`} unit="건/주" />
        <Stat label="신뢰도" value={pct(f.confidence)} unit="" />
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="text-[11px] mute2 mb-0.5">위험등급 기여도 (설명가능)</div>
        <Bar label="기온/특보" value={f.tempIndex} color={RISK_COLORS["심각"]} />
        <Bar label="고령 취약" value={f.components.elderlyIndex} color="#e87a3a" />
        <Bar label="야외 노출" value={f.components.exposureIndex} color="#e8b23a" />
        <Bar label="과거 추세" value={f.components.historyIndex} color="#3a7bd5" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-[11px] mute2">여름 주간 수요 추이</div>
        <Sparkline values={weekSeries} />
      </div>
      {air && (
        <div className="mt-3 panel-soft px-2.5 py-2 flex items-center justify-between">
          <span className="text-[11px] mute2">대기질(통합지수)</span>
          <span className="text-[12px]">
            KHAI <b>{air.khai ?? "-"}</b> <span className="muted">({air.grade ?? "-"})</span> · PM10 {air.pm10 ?? "-"}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className="panel-soft px-2 py-2 text-center">
      <div className="text-[10px] mute2">{label}</div>
      <div className={`kpi text-lg ${accent ? "text-[var(--accent-2)]" : ""}`}>{value}</div>
      <div className="text-[9px] mute2">{unit}</div>
    </div>
  );
}

// ── 취약 우선동(집계) ───────────────────────────────────────
export function PriorityDongPanel({ regionName, dongs }: { regionName: string; dongs: PriorityDong[] }) {
  if (!dongs.length) return null;
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold">취약 우선동 <span className="mute2 font-normal">{regionName}</span></h3>
        <span className="text-[10px] mute2">집계 단위 · 개인정보 미사용</span>
      </div>
      <div className="space-y-1">
        {dongs.map((d) => (
          <div key={d.dongName} className="flex items-center gap-2 text-[12px]">
            <span className="w-5 text-center font-bold text-[var(--accent-2)]">{d.rank}</span>
            <span className="w-20 font-medium">{d.dongName}</span>
            <div className="flex-1 h-2 rounded-full bg-[var(--panel-2)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(d.vulnIndex * 100)}%` }} />
            </div>
            <span className="w-9 text-right muted tabular-nums">{Math.round(d.vulnIndex * 100)}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] mute2 mt-2 leading-snug">
        고령밀도·출동경향·쉼터접근성 가중. 실명 명부가 아닌 <b>우선동(집계)</b>으로 선제 안부·예방 안내 대상을 좁힙니다.
      </div>
    </div>
  );
}

// ── 자동 브리핑 ─────────────────────────────────────────────
export function BriefingPanel({ briefing }: { briefing: Prebriefing | null }) {
  if (!briefing) return null;
  return (
    <div className="panel p-3">
      <h3 className="text-sm font-bold mb-1">자동 브리핑</h3>
      <div className="text-[13px] font-semibold leading-snug">{briefing.headline}</div>
      <div className="text-[12px] muted mt-1 leading-relaxed">{briefing.body}</div>
      <ul className="mt-2 space-y-1">
        {briefing.bullets.map((b, i) => (
          <li key={i} className="text-[12px] flex gap-1.5">
            <span className="text-[var(--accent-2)]">▸</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 백테스팅 ────────────────────────────────────────────────
export function BacktestPanel({
  metrics,
  scope,
  onScope,
}: {
  metrics: BacktestMetric[];
  scope: string;
  onScope: (s: string) => void;
}) {
  const m = metrics.find((x) => x.scope === scope) ?? metrics[0];
  if (!m) return null;
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold">예측 검증 <span className="mute2 font-normal">holdout 백테스팅</span></h3>
        <select
          value={scope}
          onChange={(e) => onScope(e.target.value)}
          className="bg-[var(--panel-2)] border border-[var(--line)] rounded-md text-[11px] px-1.5 py-1 outline-none"
        >
          {metrics.map((x) => (
            <option key={x.scope} value={x.scope}>
              {x.scopeName}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="분류 AUC" value={m.auc.toFixed(3)} unit="경계+ 판별" accent />
        <Stat label="MAE 개선" value={pct(m.improvement)} unit="↓ vs 평년" />
        {m.precisionAtK != null ? (
          <Stat label={`precision@${m.k}`} value={m.precisionAtK.toFixed(3)} unit="상위권 적중" accent />
        ) : (
          <Stat label="Brier" value={m.brier.toFixed(3)} unit="확률보정" />
        )}
      </div>
      <div className="text-[11px] muted mt-2 leading-snug">
        베이스라인(평년) MAE {m.baselineMae.toFixed(2)} → 모델 {m.mae.toFixed(2)}건/주 · Brier {m.brier.toFixed(3)}.
        {m.precisionAtK != null && (
          <> 핵심 지표 <b>precision@{m.k}</b>=주별 상위 {m.k}개 생활권 랭킹 적중률(AUC는 분류 참고치).</>
        )}{" "}
        검증표본 {num(m.n)}개(생활권-주), 구간 {m.period}. <span className="mute2">희소사건 방어 위해 생활권×주로 집계.</span>
      </div>
    </div>
  );
}

// ── 전체 요약(미선택 시) ────────────────────────────────────
export function OverallSummary({ adjusted, weekLabel, alertLabel }: { adjusted: AdjustedForecast[]; weekLabel: string; alertLabel: string }) {
  const dist: Record<RiskGrade, number> = { 관심: 0, 주의: 0, 경계: 0, 심각: 0 };
  let total = 0;
  for (const a of adjusted) {
    dist[a.grade]++;
    total += a.expectedDemand;
  }
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">전체 요약</h3>
        <span className="text-[11px] mute2">{weekLabel} · {alertLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Stat label="총 예측 수요" value={total.toFixed(0)} unit="건/주" accent />
        <Stat label="경계+ 권역" value={`${dist["경계"] + dist["심각"]}`} unit={`/ ${adjusted.length}개`} />
      </div>
      <div className="flex gap-1.5 mt-2">
        {(["관심", "주의", "경계", "심각"] as RiskGrade[]).map((g) => (
          <div key={g} className="flex-1 panel-soft py-1.5 text-center">
            <div className="text-[10px] mute2">{g}</div>
            <div className="kpi text-base" style={{ color: RISK_COLORS[g] }}>{dist[g]}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] mute2 mt-2">지도에서 생활권을 클릭하면 상세·우선동·브리핑이 표시됩니다.</div>
    </div>
  );
}
