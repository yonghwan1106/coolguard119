// 쿨가드 119 — 전역 데이터 계약(contract)
// 모든 모듈(엔진·UI·API·파이프라인)이 이 타입을 공유한다.
// 식별자는 영문, 주석은 한글.

// ─────────────────────────────────────────────────────────────
// 위험 등급 — 광역 폭염특보(주의보/경보)를 생활권×주간 단위로 재프레이밍한 4단계
export type RiskGrade = "관심" | "주의" | "경계" | "심각";

export const RISK_GRADES: RiskGrade[] = ["관심", "주의", "경계", "심각"];

// 등급별 색상(지도·카드 공통). 한색→난색 그라데이션.
export const RISK_COLORS: Record<RiskGrade, string> = {
  관심: "#2f9e6e", // 녹
  주의: "#e8b23a", // 황
  경계: "#e87a3a", // 주황
  심각: "#d4453a", // 적
};

// 기상청 폭염특보 단계(시뮬레이터 입력)
export type HeatAlertLevel = "없음" | "주의보" | "경보";

// ─────────────────────────────────────────────────────────────
// 좌표
export interface LatLng {
  lat: number;
  lng: number;
}

// 생활권(전북 시군 단위, 서울은 자치구 단위)
export interface Region {
  code: string; // 행정구역 코드(법정동/시군구 prefix)
  name: string; // 예: "전주시", "익산시"
  sido: string; // "전북특별자치도" | "서울특별시"
  centroid: LatLng;
  population: number; // 주민등록인구
  elderlyRatio: number; // 65세 이상 비율(0~1)
  shelterCount: number; // 무더위쉼터 수
  areaKm2: number;
}

// 무더위쉼터
export interface Shelter {
  id: string;
  name: string;
  lat: number;
  lng: number;
  regionCode: string;
  type: string; // 경로당 | 주민센터 | 복지관 | 은행 | 도서관 등
  capacity: number | null;
  operatingHours: string | null; // 정적 운영시간(※ '실시간 개방상태' 아님)
  isOutdoor: boolean;
}

// 온열질환 구급출동 1건(전북 융합데이터 / 서울 구급출동 시리즈에서 추출)
export interface HeatIncident {
  id: string;
  lat: number;
  lng: number;
  date: string; // ISO yyyy-mm-dd
  regionCode: string;
  ageGroup: "child" | "adult" | "elderly" | "unknown";
  nearestShelterId: string | null;
  nearestShelterDistM: number | null; // 융합데이터의 최근접쉼터 거리(m)
}

// ─────────────────────────────────────────────────────────────
// 예측 — 생활권×주(週) 단위 온열 구급수요 등급
export interface WeeklyForecast {
  regionCode: string;
  weekStart: string; // ISO, 해당 주 월요일
  grade: RiskGrade;
  expectedDemand: number; // 예측 온열 구급출동 건수(주간)
  baseline: number; // 동기 평년 베이스라인
  // 등급을 구성하는 정규화 기여도(0~1) — 설명가능성
  components: {
    tempIndex: number; // 기온/특보 외생 요인
    elderlyIndex: number; // 고령 취약 노출
    exposureIndex: number; // 야외 체류 노출(유동인구 proxy, 선택피처)
    historyIndex: number; // 과거 동기 출동 경향
  };
  // (UI 미노출) 과거 화장용 신뢰도 필드는 제거됨. 예측 신뢰는 단일 %가 아니라
  // 스코프별 holdout 백테스트(취약도 랭킹=강함 / 온열 주간=희소·참고)로 확인한다.
  confidence?: number | null;
}

// 쉼터 공백지대 격자 — 출동밀도高 × 최근접쉼터距離遠
export interface GapCell {
  id: string;
  lat: number; // 격자 중심
  lng: number;
  regionCode: string;
  incidentDensity: number; // 정규화 0~1
  nearestShelterDistM: number;
  gapScore: number; // 0~1, 높을수록 공백
  isBlindSpot: boolean; // 임계 초과 플래그
}

// 취약밀도 가중 우선동(집계 단위 — 개인 실명 명부 아님)
export interface PriorityDong {
  regionCode: string;
  dongName: string;
  vulnIndex: number; // 0~1 (고령밀도 × 출동경향 × 쉼터접근성)
  elderlyDensity: number;
  rank: number;
}

// 선배치 권고 — 평년 대비 surge(증가분)·공백지대 수 기반
export interface DeployRecommendation {
  regionCode: string;
  regionName: string;
  grade: RiskGrade;
  expectedDemand: number;
  baseline: number;
  surge: number; // 평년 대비 증가분
  blindSpots: number; // 해당 권역 공백지대 수
  action: string; // 권고 문장
  priority: number; // 정렬용
}

// 일일/주간 자동 브리핑
export interface Prebriefing {
  regionCode: string;
  weekStart: string;
  grade: RiskGrade;
  headline: string;
  body: string;
  bullets: string[];
}

// 백테스팅 지표 — '예측'의 검증가능성 입증(UI 상시 노출)
// scope 접두사로 지표 성격이 다름: vuln:*=취약도 랭킹(정규화 지수, 강함),
// overall:*/시군코드=온열 자치구×주(희소사건, 참고).
export interface BacktestMetric {
  scope: string; // "overall:<pilot>" | "vuln:<pilot>" | 시군구 코드
  scopeName: string;
  auc: number; // 분류 AUC(vuln=상위 1/3 취약 판별 / overall=상위분위 주간 판별)
  mae: number; // 오차(vuln=정규화 취약지수 / overall=주간 건수)
  brier: number; // 확률 보정
  baselineMae: number; // 베이스라인(평균/평년) 대비
  improvement: number; // (baselineMae-mae)/baselineMae
  precisionAtK?: number; // 상위 k 랭킹 적중률(핵심 의사결정 지표)
  k?: number;
  n: number; // 검증 표본 수(vuln=자치구 / overall=생활권-주)
  period: string; // 검증 구간
  metricKind?: "vuln" | "weekly"; // 캡션 단위 분기용(취약도 랭킹 vs 주간 건수)
}

// ─────────────────────────────────────────────────────────────
// 빌드타임 정적 번들 — 파이프라인 산출물(키 없이 동작하는 핵심)
export interface DataBundle {
  generatedAt: string;
  // real=모든 파일럿 실CSV, mixed=일부만 실데이터, sample=전부 대체셋.
  // 배지는 meta.sourceByPilot(파일럿별)을 우선 사용하고 이 값은 폴백.
  dataSource: "real" | "sample" | "mixed";
  pilotRegion: "전북" | "서울";
  notes: string[];
  regions: Region[];
  shelters: Shelter[];
  incidents: HeatIncident[]; // 표시·밀도용 표본
  forecasts: WeeklyForecast[];
  gapCells: GapCell[];
  priorityDongs: PriorityDong[];
  deployRecs: DeployRecommendation[];
  prebriefings: Prebriefing[];
  backtest: BacktestMetric[];
  meta: {
    weeks: string[]; // 예보 대상 주 목록
    incidentCount: number;
    shelterCount: number;
    dateRange: string;
    sources: string[]; // 데이터 출처 표기
    defaultWeek?: string; // 진입 시 기본 선택 주(피크 주)
    forecastYear?: number; // 예보 기준연도(서울 실데이터=2022)
    trainYears?: number[]; // 백테스트 학습연도
    // 파일럿별 데이터 소스(전북 sample + 서울 real 등 혼합 상태 표기)
    sourceByPilot?: Record<"전북" | "서울", "real" | "sample">;
    // 쉼터 좌표 소스: "real(행안부 무더위쉼터 전량 …)" | "synthetic" — UI 문구 조건부 전환용
    shelterSource?: string;
    // 파일럿별 쉼터 실좌표 여부(true=실좌표 전량, false=합성 표본)
    shelterRealByPilot?: Record<"전북" | "서울", boolean>;
    // 거리계산 기준(권역 귀속 전량) 쉼터 수 / 번들에 담은 표시 표본 수
    shelterTotalCount?: number;
    shelterDisplayCount?: number;
    // 전국 컨텍스트(소방청 일일상황보고) — 폭염기 구급 급증 근거 문구
    nationalContext?: {
      summerSurgeMultiplier: number;
      peakDailyEms: number;
      restDailyEms: number;
      annualDailyEms: number;
      validDays: number;
      dateRange: string;
      heatEventCount: number;
      note: string;
    } | null;
  };
}

// ─────────────────────────────────────────────────────────────
// 라이브 API 응답(graceful degrade) — 키 미발급/장애 시 degraded=true + 정적 폴백
export interface LiveHeatAlert {
  source: "기상청 API허브" | "기상특보(공공데이터포털)" | "fallback";
  fetchedAt: string;
  degraded: boolean;
  regions: {
    regionCode: string;
    alertLevel: HeatAlertLevel;
    forecastTempMax: number | null;
  }[];
}

export interface LiveAirQuality {
  source: "에어코리아" | "fallback";
  fetchedAt: string;
  degraded: boolean;
  regions: {
    regionCode: string;
    pm10: number | null;
    pm25: number | null;
    khai: number | null; // 통합대기환경지수
    grade: string | null;
  }[];
}

// 시뮬레이터 상태
export interface SimulatorState {
  alertLevel: HeatAlertLevel; // 폭염특보 토글
  weekIndex: number; // 예보 주차 인덱스
  airQualityOn: boolean; // 대기질 복합 게이지 on/off(선택피처)
}
