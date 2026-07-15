"use client";
import type { HeatAlertLevel } from "@/lib/types";
import { RISK_COLORS } from "@/lib/types";
import { weekLongLabel, weekRangeLabel, ALERT_LABEL } from "@/lib/format";

export interface Layers {
  gap: boolean;
  shelters: boolean;
  incidents: boolean;
}

export function ControlBar({
  pilot,
  onPilot,
  weeks,
  weekIndex,
  onWeekIndex,
  playing,
  onTogglePlay,
  alertOverride,
  scenarioAlert,
  onAlert,
  layers,
  onLayers,
}: {
  pilot: "전북" | "서울";
  onPilot: (p: "전북" | "서울") => void;
  weeks: string[];
  weekIndex: number;
  onWeekIndex: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  alertOverride: HeatAlertLevel | null;
  scenarioAlert: HeatAlertLevel;
  onAlert: (a: HeatAlertLevel | null) => void;
  layers: Layers;
  onLayers: (l: Layers) => void;
}) {
  const week = weeks[weekIndex];
  const effective = alertOverride ?? scenarioAlert;
  return (
    <div className="panel p-3 space-y-3">
      {/* 시범권역 */}
      <div>
        <Label>시범권역</Label>
        <div className="flex gap-1.5 mt-1">
          {(["전북", "서울"] as const).map((p) => (
            <button key={p} onClick={() => onPilot(p)} className={`btn flex-1 ${pilot === p ? "btn-active" : ""}`}>
              {p === "전북" ? "전북(메인)" : "서울(검증)"}
            </button>
          ))}
        </div>
        <p className="text-[10px] mute2 mt-1">
          {pilot === "전북"
            ? "전북(메인) — 온열 구급출동 실측(2014~2022) + 실좌표 공백지대"
            : "서울(검증) — 자치구×주 실측 시계열 · 취약도 랭킹 홀드아웃"}
        </p>
      </div>

      {/* 예보 주차 */}
      <div>
        <div className="flex items-center justify-between">
          <Label>예보 주차</Label>
          <span className="text-[11px] font-semibold">
            {weekLongLabel(week)} <span className="mute2 font-normal">({weekRangeLabel(week)})</span>
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <button onClick={onTogglePlay} className="btn px-2.5 py-1 shrink-0" title="자동 재생">
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={weeks.length - 1}
            value={weekIndex}
            onChange={(e) => onWeekIndex(Number(e.target.value))}
            className="flex-1"
          />
        </div>
      </div>

      {/* 폭염특보 시뮬레이터 */}
      <div>
        <div className="flex items-center justify-between">
          <Label>폭염특보 시뮬레이터</Label>
          {alertOverride && (
            <button onClick={() => onAlert(null)} className="text-[10px] underline mute2">
              기본 시나리오로
            </button>
          )}
        </div>
        <div className="flex gap-1.5 mt-1">
          {(["없음", "주의보", "경보"] as HeatAlertLevel[]).map((a) => (
            <button
              key={a}
              onClick={() => onAlert(a)}
              className={`btn flex-1 text-[12px] ${effective === a ? "btn-active" : ""}`}
            >
              {ALERT_LABEL[a]}
            </button>
          ))}
        </div>
        <p className="text-[10px] mute2 mt-1">
          특보를 바꾸면 생활권 등급·예측이 <b>실시간 재계산</b>됩니다(서버 왕복 없음).
          {!alertOverride && <span> 현재 = 해당 주 기본({ALERT_LABEL[scenarioAlert]}).</span>}
        </p>
      </div>

      {/* 레이어 */}
      <div>
        <Label>지도 레이어</Label>
        <div className="grid grid-cols-3 gap-1.5 mt-1">
          <Toggle on={layers.gap} onClick={() => onLayers({ ...layers, gap: !layers.gap })} label="공백지대" />
          <Toggle on={layers.shelters} onClick={() => onLayers({ ...layers, shelters: !layers.shelters })} label="쉼터" />
          <Toggle on={layers.incidents} onClick={() => onLayers({ ...layers, incidents: !layers.incidents })} label="출동밀도" />
        </div>
      </div>

      {/* 범례 */}
      <div className="pt-1 border-t" style={{ borderColor: "var(--line)" }}>
        <Label>범례</Label>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
          {(["관심", "주의", "경계", "심각"] as const).map((g) => (
            <span key={g} className="flex items-center gap-1 text-[11px]">
              <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: RISK_COLORS[g] }} /> {g}
            </span>
          ))}
        </div>
        <div className="text-[10px] mute2 mt-1">생활권 원 크기 = 예측 수요 · 흰 테두리 격자 = 공백지대</div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-bold mute2 uppercase tracking-wide">{children}</span>;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`btn text-[11px] py-1.5 ${on ? "btn-active" : "btn-ghost"}`}>
      {label}
    </button>
  );
}
