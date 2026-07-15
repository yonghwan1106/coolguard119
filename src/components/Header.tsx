"use client";

export function Header({
  dataSource,
  dataSourceTitle,
  generatedAt,
  heatSource,
  airSource,
  degraded,
}: {
  dataSource: "real" | "sample"; // 현재 선택된 파일럿의 소스
  dataSourceTitle?: string; // 파일럿별 소스 상세(배지 title)
  generatedAt: string;
  heatSource: string;
  airSource: string;
  degraded: boolean;
}) {
  return (
    <header className="flex items-center justify-between px-4 h-14 border-b shrink-0" style={{ borderColor: "var(--line)", background: "var(--bg-soft)" }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white shrink-0" style={{ background: "linear-gradient(135deg,#e2483d,#ff7a4d)" }}>
          119
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-extrabold tracking-tight">쿨가드 119</h1>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md border" style={{ borderColor: "var(--line)", color: "var(--fg-dim)" }}>
              CoolGuard
            </span>
          </div>
          <p className="text-[11px] mute2 leading-none mt-0.5">폭염 구급수요 예보 · 무더위쉼터 공백지대 콘솔</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <Badge
          tone={dataSource === "real" ? "ok" : "warn"}
          label={dataSource === "real" ? "실데이터(bigdata-119)" : "대체셋(sample)"}
          title={dataSourceTitle ?? "dataSource"}
        />
        <Badge tone={degraded ? "warn" : "ok"} label={degraded ? "라이브 폴백" : "라이브 연동"} title={`기상: ${heatSource} / 대기: ${airSource}`} />
        <span className="mute2 hidden md:inline">생성 {generatedAt}</span>
        <span className="hidden lg:inline text-[10px] px-2 py-1 rounded-md border" style={{ borderColor: "var(--line)", color: "var(--fg-dim)" }}>
          제6회 소방안전 빅데이터 경진대회
        </span>
      </div>
    </header>
  );
}

function Badge({ tone, label, title }: { tone: "ok" | "warn"; label: string; title?: string }) {
  const c = tone === "ok" ? { bg: "color-mix(in srgb,#2f9e6e 18%,transparent)", bd: "#2f9e6e", fg: "#7fe3b6" } : { bg: "color-mix(in srgb,#e8b23a 18%,transparent)", bd: "#e8b23a", fg: "#ffd97a" };
  return (
    <span title={title} className="px-2 py-1 rounded-md border font-semibold" style={{ background: c.bg, borderColor: c.bd, color: c.fg }}>
      ● {label}
    </span>
  );
}
