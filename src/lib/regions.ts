// 생활권 기준 데이터 — 전북특별자치도 14개 시군(라이브 데모 메인) + 서울 25개 자치구(일반화 검증)
// 인구·고령비율은 2024 행정안전부 주민등록인구통계 근사값, centroid는 시군구청 좌표 근사.
// shelterCount는 근사 기준값으로, 실데이터(전북 융합데이터/무더위쉼터 표준데이터) 도착 시 파이프라인이 갱신.
import type { Region } from "./types";

export const JEONBUK_REGIONS: Region[] = [
  { code: "52111", name: "전주시", sido: "전북특별자치도", centroid: { lat: 35.8242, lng: 127.148 }, population: 642000, elderlyRatio: 0.158, shelterCount: 430, areaKm2: 206 },
  { code: "52130", name: "군산시", sido: "전북특별자치도", centroid: { lat: 35.9676, lng: 126.7369 }, population: 261000, elderlyRatio: 0.205, shelterCount: 250, areaKm2: 396 },
  { code: "52140", name: "익산시", sido: "전북특별자치도", centroid: { lat: 35.9483, lng: 126.9577 }, population: 273000, elderlyRatio: 0.213, shelterCount: 300, areaKm2: 507 },
  { code: "52180", name: "정읍시", sido: "전북특별자치도", centroid: { lat: 35.5699, lng: 126.8559 }, population: 104000, elderlyRatio: 0.285, shelterCount: 320, areaKm2: 693 },
  { code: "52190", name: "남원시", sido: "전북특별자치도", centroid: { lat: 35.4164, lng: 127.3905 }, population: 78000, elderlyRatio: 0.288, shelterCount: 280, areaKm2: 752 },
  { code: "52210", name: "김제시", sido: "전북특별자치도", centroid: { lat: 35.8035, lng: 126.8809 }, population: 81000, elderlyRatio: 0.295, shelterCount: 290, areaKm2: 545 },
  { code: "52710", name: "완주군", sido: "전북특별자치도", centroid: { lat: 35.9046, lng: 127.162 }, population: 92000, elderlyRatio: 0.224, shelterCount: 240, areaKm2: 821 },
  { code: "52720", name: "진안군", sido: "전북특별자치도", centroid: { lat: 35.7917, lng: 127.4248 }, population: 25000, elderlyRatio: 0.351, shelterCount: 150, areaKm2: 789 },
  { code: "52730", name: "무주군", sido: "전북특별자치도", centroid: { lat: 36.0068, lng: 127.6608 }, population: 23000, elderlyRatio: 0.342, shelterCount: 140, areaKm2: 632 },
  { code: "52740", name: "장수군", sido: "전북특별자치도", centroid: { lat: 35.6473, lng: 127.5215 }, population: 22000, elderlyRatio: 0.349, shelterCount: 130, areaKm2: 533 },
  { code: "52750", name: "임실군", sido: "전북특별자치도", centroid: { lat: 35.6177, lng: 127.289 }, population: 27000, elderlyRatio: 0.353, shelterCount: 160, areaKm2: 597 },
  { code: "52770", name: "순창군", sido: "전북특별자치도", centroid: { lat: 35.3744, lng: 127.1376 }, population: 27000, elderlyRatio: 0.352, shelterCount: 150, areaKm2: 496 },
  { code: "52790", name: "고창군", sido: "전북특별자치도", centroid: { lat: 35.4357, lng: 126.7019 }, population: 52000, elderlyRatio: 0.323, shelterCount: 230, areaKm2: 607 },
  { code: "52800", name: "부안군", sido: "전북특별자치도", centroid: { lat: 35.7318, lng: 126.733 }, population: 50000, elderlyRatio: 0.321, shelterCount: 210, areaKm2: 493 },
];

export const SEOUL_REGIONS: Region[] = [
  { code: "11110", name: "종로구", sido: "서울특별시", centroid: { lat: 37.5731, lng: 126.9793 }, population: 142000, elderlyRatio: 0.213, shelterCount: 120, areaKm2: 24 },
  { code: "11140", name: "중구", sido: "서울특별시", centroid: { lat: 37.5636, lng: 126.9976 }, population: 121000, elderlyRatio: 0.221, shelterCount: 110, areaKm2: 10 },
  { code: "11170", name: "용산구", sido: "서울특별시", centroid: { lat: 37.5326, lng: 126.99 }, population: 217000, elderlyRatio: 0.197, shelterCount: 150, areaKm2: 22 },
  { code: "11200", name: "성동구", sido: "서울특별시", centroid: { lat: 37.5634, lng: 127.0369 }, population: 281000, elderlyRatio: 0.183, shelterCount: 160, areaKm2: 17 },
  { code: "11215", name: "광진구", sido: "서울특별시", centroid: { lat: 37.5385, lng: 127.0823 }, population: 339000, elderlyRatio: 0.171, shelterCount: 170, areaKm2: 17 },
  { code: "11230", name: "동대문구", sido: "서울특별시", centroid: { lat: 37.5744, lng: 127.0398 }, population: 339000, elderlyRatio: 0.205, shelterCount: 180, areaKm2: 14 },
  { code: "11260", name: "중랑구", sido: "서울특별시", centroid: { lat: 37.6065, lng: 127.0927 }, population: 387000, elderlyRatio: 0.205, shelterCount: 190, areaKm2: 19 },
  { code: "11290", name: "성북구", sido: "서울특별시", centroid: { lat: 37.5894, lng: 127.0167 }, population: 432000, elderlyRatio: 0.196, shelterCount: 210, areaKm2: 25 },
  { code: "11305", name: "강북구", sido: "서울특별시", centroid: { lat: 37.6396, lng: 127.0257 }, population: 295000, elderlyRatio: 0.234, shelterCount: 200, areaKm2: 24 },
  { code: "11320", name: "도봉구", sido: "서울특별시", centroid: { lat: 37.6688, lng: 127.0471 }, population: 312000, elderlyRatio: 0.224, shelterCount: 190, areaKm2: 21 },
  { code: "11350", name: "노원구", sido: "서울특별시", centroid: { lat: 37.6542, lng: 127.0568 }, population: 497000, elderlyRatio: 0.198, shelterCount: 240, areaKm2: 35 },
  { code: "11380", name: "은평구", sido: "서울특별시", centroid: { lat: 37.6027, lng: 126.9291 }, population: 467000, elderlyRatio: 0.205, shelterCount: 230, areaKm2: 30 },
  { code: "11410", name: "서대문구", sido: "서울특별시", centroid: { lat: 37.5791, lng: 126.9368 }, population: 308000, elderlyRatio: 0.197, shelterCount: 170, areaKm2: 18 },
  { code: "11440", name: "마포구", sido: "서울특별시", centroid: { lat: 37.5663, lng: 126.9019 }, population: 366000, elderlyRatio: 0.171, shelterCount: 180, areaKm2: 24 },
  { code: "11470", name: "양천구", sido: "서울특별시", centroid: { lat: 37.5169, lng: 126.8664 }, population: 437000, elderlyRatio: 0.171, shelterCount: 200, areaKm2: 17 },
  { code: "11500", name: "강서구", sido: "서울특별시", centroid: { lat: 37.5509, lng: 126.8495 }, population: 568000, elderlyRatio: 0.185, shelterCount: 260, areaKm2: 41 },
  { code: "11530", name: "구로구", sido: "서울특별시", centroid: { lat: 37.4954, lng: 126.8874 }, population: 396000, elderlyRatio: 0.197, shelterCount: 200, areaKm2: 20 },
  { code: "11545", name: "금천구", sido: "서울특별시", centroid: { lat: 37.4569, lng: 126.8956 }, population: 229000, elderlyRatio: 0.189, shelterCount: 140, areaKm2: 13 },
  { code: "11560", name: "영등포구", sido: "서울특별시", centroid: { lat: 37.5264, lng: 126.8962 }, population: 376000, elderlyRatio: 0.182, shelterCount: 190, areaKm2: 24 },
  { code: "11590", name: "동작구", sido: "서울특별시", centroid: { lat: 37.5124, lng: 126.9393 }, population: 383000, elderlyRatio: 0.193, shelterCount: 180, areaKm2: 16 },
  { code: "11620", name: "관악구", sido: "서울특별시", centroid: { lat: 37.4784, lng: 126.9516 }, population: 488000, elderlyRatio: 0.184, shelterCount: 230, areaKm2: 30 },
  { code: "11650", name: "서초구", sido: "서울특별시", centroid: { lat: 37.4836, lng: 127.0327 }, population: 408000, elderlyRatio: 0.166, shelterCount: 200, areaKm2: 47 },
  { code: "11680", name: "강남구", sido: "서울특별시", centroid: { lat: 37.5172, lng: 127.0473 }, population: 533000, elderlyRatio: 0.158, shelterCount: 250, areaKm2: 40 },
  { code: "11710", name: "송파구", sido: "서울특별시", centroid: { lat: 37.5145, lng: 127.1066 }, population: 656000, elderlyRatio: 0.166, shelterCount: 280, areaKm2: 34 },
  { code: "11740", name: "강동구", sido: "서울특별시", centroid: { lat: 37.5301, lng: 127.1238 }, population: 462000, elderlyRatio: 0.176, shelterCount: 220, areaKm2: 25 },
];

// 라이브 데모 메인 = 전북. 검증 패널 = 서울.
export const REGIONS_BY_PILOT: Record<"전북" | "서울", Region[]> = {
  전북: JEONBUK_REGIONS,
  서울: SEOUL_REGIONS,
};

export const ALL_REGIONS: Region[] = [...JEONBUK_REGIONS, ...SEOUL_REGIONS];

export function regionByCode(code: string): Region | undefined {
  return ALL_REGIONS.find((r) => r.code === code);
}
