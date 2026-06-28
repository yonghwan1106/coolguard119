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
  confidence: number; // 0~1, 백테스팅 기반 신뢰도
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
export interface BacktestMetric {
  scope: string; // "overall" | regionCode
  scopeName: string;
  auc: number; // 경계+ 등급 분류 AUC
  mae: number; // 주간 건수 평균절대오차
  brier: number; // 확률 보정
  baselineMae: number; // 평년 베이스라인 대비
  improvement: number; // (baselineMae-mae)/baselineMae
  n: number; // 검증 표본 수(생활권-주)
  period: string; // 검증 구간
}

// ─────────────────────────────────────────────────────────────
// 빌드타임 정적 번들 — 파이프라인 산출물(키 없이 동작하는 핵심)
export interface DataBundle {
  generatedAt: string;
  dataSource: "real" | "sample"; // real=bigdata-119 실CSV, sample=공개통계 기반 대체셋
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
  };
}

// ─────────────────────────────────────────────────────────────
// 라이브 API 응답(graceful degrade) — 키 미발급/장애 시 degraded=true + 정적 폴백
export interface LiveHeatAlert {
  source: "기상청 API허브" | "fallback";
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
