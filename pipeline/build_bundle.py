#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
쿨가드 119 — 데이터 정제·사전계산 파이프라인 (stdlib만 사용, 재현가능 seed)

역할:
  1) _data_raw/ 의 bigdata-119 실CSV를 case-insensitive 컬럼매칭으로 인제스트
       - 서울 온열질환 구급출동(2017~2022, 자치구 단위)  → 실측 온열 출동 시계열
       - 서울 고령자 안전사고 구급출동(스트리밍)          → 자치구 고령 취약 신호
       - 소방청 일일상황보고(daily119_through)             → 전국 컨텍스트(폭염기 구급 급증)
       - 전북 온열질환-무더위쉼터 융합데이터(도착 시)      → 실좌표 출동점·시간단위 기온
       - 무더위쉼터 표준데이터(도착 시)                     → 쉼터 실좌표
  2) 실CSV가 없는 권역은 공개통계 기반 grounded 대체셋(sample)으로 자동 전환
  3) 생활권×주(週) 온열 구급수요 예측 등급 + 쉼터 공백지대 격자 + 취약 우선동
       + 선배치 권고 + 자동 브리핑 + holdout 백테스팅(AUC/MAE/Brier/precision@k) 사전계산
  4) src/data/bundle.json 으로 출력 (앱이 키 없이 읽는 정적 번들)

설계:
  - 예보 기준연도 = 2022 (서울 실데이터의 최신 완전연도). 학습 2017~2021 → 예측 2022 여름 →
    실측 2022와 비교하는 진짜 holdout 백테스트. 두 파일럿이 동일 주(週) 슬라이더를 공유하도록
    양 권역 모두 2022 여름 15주를 예보 horizon으로 정렬한다.
  - 서울은 좌표가 없으므로 지도 출동점은 '자치구 단위 실건수의 시각화용 근사배치'(정직성 명시).
  - 실데이터 부분은 결정론적(seed 고정). 대체셋만 난수 사용.

파일이 추가로 도착하면 같은 명령으로 재실행하면 해당 권역의 sourceByPilot 가 "real"로 전환된다.
"""
import csv
import glob
import json
import math
import os
import random
import sys
import zlib
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
CONTEST_DIR = "0805_소방안전 빅데이터 활용 및 아이디어 경진대회"
RAW_DIRS = [
    os.path.join(PROJ, "_data_raw"),
    os.path.join(os.path.dirname(PROJ), CONTEST_DIR, "_data_raw"),
    # 이 PC 실제 드롭 폴더(공모전 작업트리) — 프로젝트와 데이터 루트가 분리되어 있음
    os.path.join(os.path.expanduser("~"), "Desktop", "contest-projects-2026", CONTEST_DIR, "_data_raw"),
]
# 환경변수로 재정의 가능(supervisor 재현성)
if os.environ.get("COOLGUARD_DATA_RAW"):
    RAW_DIRS.insert(0, os.environ["COOLGUARD_DATA_RAW"])
OUT = os.path.join(PROJ, "src", "data", "bundle.json")
SEED = os.path.join(PROJ, "src", "data", "regions_seed.json")

random.seed(20260805)  # 마감일 seed — 재현가능(대체셋 전용)
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))  # 일일상황보고 raw_text 대비

# ── 예보/학습 시간축 ──────────────────────────────────────────
SUMMER_N = 15                     # 여름 주(週) 창 크기(연도 간 인덱스 정렬용 고정값)
TRAIN_YEARS = [2017, 2018, 2019, 2020, 2021]
FORECAST_YEAR = 2022              # 서울 실데이터 최신 완전연도 = holdout 대상

# ── 폭염특보 계수(clientEngine.ts 와 1:1 미러) ─────────────────
ALERT_TEMP_DELTA = {"없음": 0.0, "주의보": 0.12, "경보": 0.25}
ALERT_DEMAND_MULT = {"없음": 0.0, "주의보": 0.15, "경보": 0.35}
W_TEMP, W_ELDERLY, W_EXPOSURE, W_HISTORY = 0.40, 0.24, 0.16, 0.20

# ── 전북 시군별 실제 읍면동 시드(취약 우선동 라벨 현실화) ───────────────
JEONBUK_DONGS = {
    "52111": ["효자동", "송천동", "인후동", "평화동", "서신동", "우아동"],
    "52130": ["나운동", "수송동", "조촌동", "미성동", "옥산면"],
    "52140": ["영등동", "어양동", "부송동", "함열읍", "황등면"],
    "52180": ["수성동", "연지동", "신태인읍", "태인면", "입암면"],
    "52190": ["도통동", "죽항동", "운봉읍", "인월면", "산내면"],
    "52210": ["요촌동", "신풍동", "만경읍", "금구면", "봉남면"],
    "52710": ["봉동읍", "삼례읍", "용진읍", "고산면", "운주면"],
    "52720": ["진안읍", "마령면", "부귀면", "정천면"],
    "52730": ["무주읍", "설천면", "안성면", "무풍면"],
    "52740": ["장수읍", "장계면", "산서면", "번암면"],
    "52750": ["임실읍", "오수면", "강진면", "관촌면"],
    "52770": ["순창읍", "인계면", "복흥면", "쌍치면"],
    "52790": ["고창읍", "흥덕면", "무장면", "아산면", "공음면"],
    "52800": ["부안읍", "줄포면", "변산면", "행안면", "보안면"],
}
SHELTER_TYPES = ["경로당", "주민센터", "복지관", "마을회관", "도서관", "은행"]

# 권역당 실쉼터가 이 값 미만이면 합성 표본을 유지(소수 표본이 합성 레이어를 대체·왜곡하는 것 차단)
MIN_REAL_SHELTERS = 30

# 번들에 담는 표시 쉼터 상한(파일럿당). 거리계산은 전량 기준, 표시만 결정론적 표본으로 축약해 bundle 용량 사수.
MAX_DISPLAY_SHELTERS_PER_PILOT = 400

# 전국 무더위쉼터 실좌표 파일에서 파일럿(전북/서울)만 주소 앞토큰으로 선필터 → 타지역 대량행 조기 드롭(성능·경계오귀속 방지).
SHELTER_SIDO_PREFIX = {
    "전북": ("전북", "전라북"),
    "서울": ("서울",),
}


def shelter_hours(night, weekend):
    """야간운영·주말운영 플래그(Y/N) → 운영시간 표현 문자열('실시간 개방상태' 아님·정적 표기)."""
    def yes(v):
        return str(v or "").strip().upper() in ("Y", "1", "YES", "O", "T", "TRUE")
    n, w = yes(night), yes(weekend)
    if n and w:
        return "주간+야간·주말 연장운영"
    if n:
        return "주간+야간 운영(주말 미운영)"
    if w:
        return "주간+주말 운영(야간 미운영)"
    return "주간 운영(야간·주말 미운영)"


def addr_pilot(addr):
    """도로명주소 앞토큰 → 파일럿('전북'|'서울'|'other'|'unknown')."""
    a = (addr or "").strip()
    if not a:
        return "unknown"
    tok = a.split()[0]
    for pilot, prefixes in SHELTER_SIDO_PREFIX.items():
        if any(tok.startswith(p) for p in prefixes):
            return pilot
    return "other"


def load_seed():
    with open(SEED, "r", encoding="utf-8") as f:
        return json.load(f)


# ── 실CSV 탐지(내용 기반 권역 판별) ───────────────────────────
def _sniff_header_ctpv(path, sample=100):
    """CSV 헤더 + 데이터 첫 N행을 읽어 (좌표컬럼 존재, 시도명 다수결)을 반환.
    파일명 휴리스틱 대신 내용으로 권역을 결정하기 위한 스니핑."""
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            header = next(rd, None)
            if not header:
                return None, False, ""
            low = [(h or "").strip().lower().lstrip("﻿") for h in header]
            has_coord = "acdnt_ocrn_lat" in low
            i_ctpv = low.index("grnds_ctpv_nm") if "grnds_ctpv_nm" in low else -1
            ctpv = Counter()
            if i_ctpv >= 0:
                for i, row in enumerate(rd):
                    if i >= sample:
                        break
                    if len(row) > i_ctpv and row[i_ctpv].strip():
                        ctpv[row[i_ctpv].strip()] += 1
            top = ctpv.most_common(1)[0][0] if ctpv else ""
            return header, has_coord, top
    except Exception:
        return None, False, ""


def _region_of_ctpv(ctpv_top, fname):
    """시도명 다수결 → 파일럿 권역. 실패 시 파일명 prefix 폴백."""
    t = ctpv_top or ""
    if "전라북" in t or "전북" in t:
        return "전북"
    if "서울" in t:
        return "서울"
    # 폴백: 서울소방재난본부 prefix 파일은 좌표가 없어 CTPV만으로 판별
    if "서울소방재난본부" in fname:
        return "서울"
    return None


def find_raw():
    """드롭 폴더에서 알려진 데이터셋을 (권역×역할)로 탐지.
    권역=데이터 시도명(GRNDS_CTPV_NM) 다수결(내용 기반), 역할=파일명 키워드(온열/고령자).
    '표본' 쉼터 파일은 shelter_excluded 로 분리(승격 차단)."""
    found = {"seoul_heat": [], "seoul_elderly": [], "jeonbuk_heat": [], "jeonbuk_elderly": [],
             "shelter": [], "shelter_excluded": [], "daily_dir": None}
    for d in RAW_DIRS:
        if not os.path.isdir(d):
            continue
        for sub in glob.glob(os.path.join(d, "**", "daily_summaries.csv"), recursive=True):
            found["daily_dir"] = os.path.dirname(sub)
        for path in glob.glob(os.path.join(d, "**", "*.csv"), recursive=True) + \
                glob.glob(os.path.join(d, "**", "*.json"), recursive=True):
            name = os.path.basename(path)
            low = name.replace(" ", "")
            if os.path.basename(path) == "daily_summaries.csv":
                continue
            # 쉼터: '표본' 포함 시 승격 차단(합성 유지). 전량 파일만 shelter 로.
            if "무더위쉼터" in low or "shelter" in low.lower():
                if "표본" in low or "sample" in low.lower():
                    found["shelter_excluded"].append(path)
                else:
                    found["shelter"].append(path)
                continue
            # 역할(파일명) — 온열/고령자만 인제스트 대상
            if "온열" in low and "구급" in low:
                role = "heat"
            elif "고령자" in low and "구급" in low:
                role = "elderly"
            else:
                continue
            # 권역(내용): 헤더+첫 100행 CTPV 다수결
            _hdr, _coord, ctpv_top = _sniff_header_ctpv(path)
            region = _region_of_ctpv(ctpv_top, name)
            if region == "전북":
                found[f"jeonbuk_{role}"].append(path)
            elif region == "서울":
                found[f"seoul_{role}"].append(path)
            # region None(관할 외) → 드롭
    for k in ("seoul_heat", "seoul_elderly", "jeonbuk_heat", "jeonbuk_elderly", "shelter", "shelter_excluded"):
        found[k] = sorted(set(found[k]))
    return found


def col_index(header, *aliases):
    """헤더(리스트)에서 별칭 중 하나와 case-insensitive 일치하는 컬럼 인덱스."""
    low = [(h or "").strip().lower().lstrip("﻿") for h in header]
    for a in aliases:
        a = a.lower()
        if a in low:
            return low.index(a)
    return -1


def try_float(v):
    try:
        return float(str(v).strip())
    except Exception:
        return None


def parse_ymd(s):
    """'20170101' 또는 '2017-01-01' → date."""
    s = str(s).strip()[:10]
    if not s:
        return None
    try:
        if "-" in s:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        return datetime.strptime(s[:8], "%Y%m%d").date()
    except Exception:
        return None


# ── 주(週) 유틸 ───────────────────────────────────────────────
def monday(d):
    return d - timedelta(days=d.weekday())


def summer_weeks(year):
    """monday(6/1) 부터 SUMMER_N 주 — 연도 간 인덱스가 정렬되도록 고정 길이."""
    start = monday(date(year, 6, 1))
    return [start + timedelta(days=7 * i) for i in range(SUMMER_N)]


def heat_week_factor(d):
    """여름 주차별 온열 강도(0~1) — 7월말~8월초 피크의 종형 곡선(기온 외생요인 프록시)."""
    peak = date(d.year, 8, 4)
    diff = abs((d - peak).days)
    return max(0.05, math.exp(-((diff / 24.0) ** 2)))


TRAIN_WEEK_LISTS = {y: summer_weeks(y) for y in TRAIN_YEARS}      # 연도→15주
FORECAST_WEEKS = summer_weeks(FORECAST_YEAR)                      # 15주(2022)
ALL_SUMMER_MONDAYS = set()
for _y in TRAIN_YEARS + [FORECAST_YEAR]:
    for _w in summer_weeks(_y):
        ALL_SUMMER_MONDAYS.add(_w.isoformat())


def alert_for(w):
    f = heat_week_factor(w)
    return "경보" if f > 0.75 else ("주의보" if f > 0.45 else "없음")


ALERT_BY_WEEK = {}
for _y in TRAIN_YEARS + [FORECAST_YEAR]:
    for _w in summer_weeks(_y):
        ALERT_BY_WEEK[_w.isoformat()] = alert_for(_w)


# ── 등급 매핑 / 정규화 ────────────────────────────────────────
def grade_of(score):
    if score >= 0.80:
        return "심각"
    if score >= 0.60:
        return "경계"
    if score >= 0.40:
        return "주의"
    return "관심"


def normalize(v, lo, hi):
    if hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (v - lo) / (hi - lo)))


# =====================================================================
#  인제스트 계층 (실데이터)
# =====================================================================
def name_to_code(regions):
    return {r["name"]: r["code"] for r in regions}


def make_resolver(regions):
    """시군구명 → 코드. 분구 시(전주시완산구/덕진구 등)는 '전주시'로 정규화해 흡수.
    존재하는 코드로만 귀속되므로 관할 외 분구는 자연히 None(드롭)."""
    n2c = name_to_code(regions)
    names = set(n2c)

    def resolve(raw):
        s = (raw or "").strip()
        if not s:
            return None
        if s in n2c:
            return n2c[s]
        if "시" in s:                       # '전주시완산구' → '전주시'
            cand = s[: s.index("시") + 1]
            if cand in n2c:
                return n2c[cand]
        return None

    return resolve


def ingest_seoul_heat(paths, regions):
    """서울 온열질환 구급출동 CSV(복수) → weekly[code][weekISO]=건수 (여름주만).
    total=원본 총행수(여름창 밖 포함) / kept=여름 15주 창 내 건수(정직성 note용)."""
    resolve = make_resolver(regions)
    weekly = defaultdict(lambda: defaultdict(int))
    kept = 0
    total = 0
    dropped_region = 0
    for path in paths:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            header = next(rd, None)
            if not header:
                continue
            i_sgg = col_index(header, "grnds_sgg_nm")
            i_ymd = col_index(header, "dclr_ymd")
            if i_sgg < 0 or i_ymd < 0:
                continue
            wide = max(i_sgg, i_ymd)
            for row in rd:
                if len(row) <= wide:
                    continue
                total += 1
                code = resolve(row[i_sgg])
                if not code:                      # 하남시(경기) 등 관할외 혼입 → 제외
                    dropped_region += 1
                    continue
                d = parse_ymd(row[i_ymd])
                if not d:
                    continue
                wk = monday(d).isoformat()
                if wk not in ALL_SUMMER_MONDAYS:   # 여름 창(6/1~) 밖은 예보대상 아님
                    continue
                weekly[code][wk] += 1
                kept += 1
    return weekly, {"kept": kept, "total": total, "droppedNonSeoul": dropped_region}


def ingest_elderly(paths, regions):
    """고령자 안전사고 구급출동 CSV(대용량) 스트리밍 → 시군구별 고령EMS 부하·온열·낙상.
    학습(2017~2021)/검증(2022)은 **행 단위 연도(DCLR_YR)**로 분리(파일명 무관, 다년 통합파일 안전).
    취약도 랭킹 holdout 백테스트 + elderlyIndex 실측화에 사용. (서울·전북 공용)"""
    resolve = make_resolver(regions)
    total, heat, fall = Counter(), Counter(), Counter()
    train, test = Counter(), Counter()
    rows_seen = 0
    for path in paths:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            header = next(rd, None)
            if not header:
                continue
            i_sgg = col_index(header, "grnds_sgg_nm")
            i_ctpv = col_index(header, "grnds_ctpv_nm")
            i_yr = col_index(header, "dclr_yr")
            i_ymd = col_index(header, "dclr_ymd")
            i_thml = col_index(header, "thml_damg_nm")
            i_injr = col_index(header, "acdnt_injr_nm")
            if i_sgg < 0:
                continue
            wide = max(i_sgg, i_ctpv, i_yr, i_thml, i_injr)
            for row in rd:
                rows_seen += 1
                if len(row) <= wide:
                    continue
                if i_ctpv >= 0:                    # 관할 외 시도 혼입 제거(엄격 매칭)
                    ct = row[i_ctpv].strip()
                    if ct and not ("전라북" in ct or "전북" in ct or "서울" in ct):
                        continue
                code = resolve(row[i_sgg])
                if not code:
                    continue
                # 행 단위 연도
                yr = None
                if i_yr >= 0 and str(row[i_yr]).strip()[:4].isdigit():
                    yr = int(str(row[i_yr]).strip()[:4])
                elif i_ymd >= 0:
                    d = parse_ymd(row[i_ymd])
                    yr = d.year if d else None
                total[code] += 1
                if yr == FORECAST_YEAR:
                    test[code] += 1
                elif yr in TRAIN_YEARS:
                    train[code] += 1
                if i_thml >= 0 and row[i_thml].strip():
                    heat[code] += 1
                if i_injr >= 0 and row[i_injr].strip() == "낙상":
                    fall[code] += 1
    return {"total": total, "heat": heat, "fall": fall,
            "train": train, "test": test, "rowsSeen": rows_seen}


def elderly_index_from_signal(regions, elderly):
    """자치구 census 고령비율 + 실측 고령EMS 부하(인구천명당)를 5:5 블렌딩 → elderlyIndex 오버라이드.
    표시값도 **학습연도(2017~2021)만** 사용해 leakage 없이 산출(백테스트와 동일 스코프)."""
    if not elderly:
        return None
    signal = elderly.get("train") or elderly.get("total")
    if not signal:
        return None
    per_k = {}
    for r in regions:
        t = signal.get(r["code"], 0)
        per_k[r["code"]] = t / max(1.0, r["population"] / 1000.0)
    vals = [v for v in per_k.values() if v > 0]
    lo, hi = (min(vals), max(vals)) if vals else (0.0, 1.0)
    out = {}
    for r in regions:
        census = normalize(r["elderlyRatio"], 0.14, 0.36)
        burden = normalize(per_k[r["code"]], lo, hi)
        out[r["code"]] = round(max(0.0, min(1.0, 0.5 * census + 0.5 * burden)), 3)
    return out


def ingest_jeonbuk_heat(paths, regions):
    """전북 온열질환 구급출동 실CSV → 실좌표 출동점 + weekly(여름주) + 여름 출동시점 기온 분포.
    대문자 스키마(ACDNT_OCRN_LAT/LOT·HR_UNIT_ARTMP), case-insensitive 매칭. 분구는 '전주시'로 정규화."""
    resolve = make_resolver(regions)
    weekly = defaultdict(lambda: defaultdict(int))
    points = []
    summer_temps = []            # 여름창 출동시점 시간단위 기온(℃) — 온열 강도 근거
    kept = 0
    total = 0
    ctpv_drop = 0
    idx = 0
    summer_by_year = Counter()
    for path in paths:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            header = next(rd, None)
            if not header:
                continue
            i_lat = col_index(header, "acdnt_ocrn_lat", "lat", "위도")
            i_lot = col_index(header, "acdnt_ocrn_lot", "lon", "lng", "경도")
            i_ymd = col_index(header, "dclr_ymd", "dspt_ymd", "grnds_arvl_ymd")
            i_sgg = col_index(header, "grnds_sgg_nm")
            i_ctpv = col_index(header, "grnds_ctpv_nm")
            i_tmp = col_index(header, "hr_unit_artmp")
            i_dist = col_index(header, "grnds_dstnc")
            wide = max(i for i in [i_lat, i_lot, i_ymd, i_sgg] if i >= 0)
            for row in rd:
                if len(row) <= wide:
                    continue
                total += 1
                # 엄격 CTPV: 전라북/전북만(전라남도 등 '전' 포함 오통과 차단)
                if i_ctpv >= 0 and row[i_ctpv].strip():
                    ct = row[i_ctpv].strip()
                    if not ("전라북" in ct or "전북" in ct):
                        ctpv_drop += 1
                        continue
                code = resolve(row[i_sgg]) if i_sgg >= 0 else None
                d = parse_ymd(row[i_ymd]) if i_ymd >= 0 else None
                la = try_float(row[i_lat]) if i_lat >= 0 else None
                lo = try_float(row[i_lot]) if i_lot >= 0 else None
                if not code or not d:
                    continue
                wk = monday(d).isoformat()
                is_summer = wk in ALL_SUMMER_MONDAYS
                if not is_summer:
                    # 온열질환 데이터셋은 연중 기록(한랭 사례 등 포함)을 담고 있어,
                    # 폭염 콘솔의 출동밀도·공백지대에는 여름 15주 창(고온기)만 반영(정직성).
                    continue
                weekly[code][wk] += 1
                kept += 1
                summer_by_year[d.year] += 1
                if i_tmp >= 0:
                    tv = try_float(row[i_tmp])
                    if tv is not None:
                        summer_temps.append(tv)
                if la is not None and lo is not None and 33 < la < 39 and 124 < lo < 132:
                    points.append({
                        "id": f"{code}-R{idx:05d}", "lat": la, "lng": lo,
                        "date": d.isoformat(), "regionCode": code,
                        "ageGroup": "unknown", "nearestShelterId": None,
                        "nearestShelterDistM": None,
                    })
                    idx += 1
    st = sorted(summer_temps)
    temp_stats = None
    if st:
        n = len(st)
        temp_stats = {
            "n": n,
            "median": round(st[n // 2], 1),
            "pct33": round(100 * sum(1 for t in st if t >= 33) / n, 1),
            "pct30": round(100 * sum(1 for t in st if t >= 30) / n, 1),
        }
    return weekly, points, {
        "kept": kept, "total": total, "points": len(points),
        "ctpvDrop": ctpv_drop, "tempStats": temp_stats,
        "summerByYear": dict(sorted(summer_by_year.items())),
    }


def ingest_shelters(paths, regions):
    """무더위쉼터 실좌표 파일(csv|json) → 쉼터 리스트 + 인제스트 통계.
    행안부 무더위쉼터 전량(58k) 스트리밍 인제스트: 도로명주소 앞토큰으로 전북/서울만 선필터한 뒤
    좌표→최근접 생활권 귀속(0.25° 가드). 이용가능인원→capacity, 야간/주말→operatingHours, 유형→type 실값 매핑.
    좌표(전량)는 거리계산 기준으로 그대로 유지하고, 표시 상한은 build_pilot 에서 적용한다."""
    out = []
    stats = {"rowsRead": 0, "kept": 0, "droppedAddr": 0, "droppedCoord": 0,
             "droppedRegionGuard": 0, "byPilot": Counter()}
    pilot_of_code = {}
    for r in regions:
        pilot_of_code[r["code"]] = "전북" if str(r["code"]).startswith("52") else "서울"
    for path in paths:
        try:
            def iter_rows(path):
                """csv/json 공통 스트리밍 이터레이터 → (header, get(row,i)-호환 dict-like row) 단위."""
                if path.lower().endswith(".json"):
                    with open(path, "r", encoding="utf-8-sig") as f:
                        j = json.load(f)
                    items = j if isinstance(j, list) else (j.get("records") or j.get("data") or [])
                    if not items or not isinstance(items[0], dict):
                        return
                    header = list(items[0].keys())
                    yield ("__header__", header)
                    for it in items:
                        yield ("row", [it.get(h) for h in header])
                else:
                    with open(path, "r", encoding="utf-8-sig", newline="") as f:
                        rd = csv.reader(f)
                        header = next(rd, None)
                        if not header:
                            return
                        yield ("__header__", header)
                        for row in rd:
                            yield ("row", row)

            it = iter_rows(path)
            first = next(it, None)
            if not first or first[0] != "__header__":
                continue
            header = first[1]
            i_lat = col_index(header, "lat", "위도", "la", "y", "ycrd")
            i_lot = col_index(header, "lng", "lon", "경도", "lo", "x", "xcrd")
            i_nm = col_index(header, "쉼터명칭", "시설명", "name", "쉼터명", "fclt_nm")
            i_ty = col_index(header, "쉼터유형", "type", "구분")
            i_cap = col_index(header, "이용가능인원", "수용가능인원", "수용인원", "capacity", "use_prnb")
            i_addr = col_index(header, "도로명주소", "소재지도로명주소", "주소", "rn_adres", "address")
            i_night = col_index(header, "야간운영", "야간개방", "night")
            i_week = col_index(header, "주말운영", "주말개방", "weekend")
            if i_lat < 0 or i_lot < 0:
                continue
            wide = max(x for x in [i_lat, i_lot, i_nm, i_ty, i_cap, i_addr, i_night, i_week] if x >= 0)
            k = -1
            for kind, row in it:
                if kind != "row":
                    continue
                k += 1
                if len(row) <= wide:
                    continue
                stats["rowsRead"] += 1
                # 1) 주소 앞토큰 선필터: 전북/서울만 통과(other=타지역 대량행 조기 드롭, unknown=주소결측은 좌표로 판정)
                if i_addr >= 0:
                    ap = addr_pilot(row[i_addr])
                    if ap == "other":
                        stats["droppedAddr"] += 1
                        continue
                la = try_float(row[i_lat] if i_lat >= 0 else None)
                lo = try_float(row[i_lot] if i_lot >= 0 else None)
                if la is None or lo is None or not (33 < la < 39) or not (124 < lo < 132):
                    stats["droppedCoord"] += 1
                    continue
                # 2) 최근접 생활권 귀속
                best, bcode = 1e18, None
                for r in regions:
                    c = r["centroid"]
                    dd = (la - c["lat"]) ** 2 + (lo - c["lng"]) ** 2
                    if dd < best:
                        best, bcode = dd, r["code"]
                # 권역 불일치 가드: 최근접 센트로이드가 ~28km(0.25deg) 밖이면 타지역 → 제외
                if bcode is None or best > 0.25 ** 2:
                    stats["droppedRegionGuard"] += 1
                    continue
                nm = row[i_nm] if i_nm >= 0 else None
                cap = None
                if i_cap >= 0:
                    cv = try_float(row[i_cap])
                    cap = int(cv) if cv is not None and cv > 0 else None
                out.append({
                    "id": f"{bcode}-RS{k:05d}",
                    "name": str(nm).strip() if nm else f"무더위쉼터 {k + 1}",
                    "lat": round(la, 5), "lng": round(lo, 5),
                    "regionCode": bcode,
                    "type": (str(row[i_ty]).strip() if i_ty >= 0 and str(row[i_ty]).strip() else "쉼터"),
                    "capacity": cap,
                    "operatingHours": (shelter_hours(row[i_night] if i_night >= 0 else None,
                                                     row[i_week] if i_week >= 0 else None)
                                       if (i_night >= 0 or i_week >= 0) else "주간 운영(정적 표기)"),
                    "isOutdoor": False,
                })
                stats["kept"] += 1
                stats["byPilot"][pilot_of_code.get(bcode, "?")] += 1
        except Exception as e:
            print(f"  ! 쉼터 파싱 실패 {os.path.basename(path)}: {e}", file=sys.stderr)
    stats["byPilot"] = dict(stats["byPilot"])
    return out, stats


def national_context(daily_dir):
    """소방청 일일상황보고 → 폭염기(7~8월) 전국 구급출동 급증 배수 + 온열 사례 건수."""
    if not daily_dir:
        return None
    sd_path = os.path.join(daily_dir, "source_documents.csv")
    ds_path = os.path.join(daily_dir, "daily_summaries.csv")
    ir_path = os.path.join(daily_dir, "incident_records.csv")
    if not (os.path.exists(sd_path) and os.path.exists(ds_path)):
        return None
    EXCLUDE = {"2024-02-01", "2024-02-02"}  # 품질 플래그(오귀속·중복)
    # id -> report_date
    id2date = {}
    with open(sd_path, "r", encoding="utf-8-sig", newline="") as f:
        rd = csv.reader(f)
        header = next(rd)
        i_id = col_index(header, "id")
        i_rd = col_index(header, "report_date")
        for row in rd:
            if len(row) <= max(i_id, i_rd):
                continue
            id2date[row[i_id].strip()] = row[i_rd].strip()[:10]
    # ems_count by activity month
    peak_vals, rest_vals, all_vals = [], [], []
    with open(ds_path, "r", encoding="utf-8-sig", newline="") as f:
        rd = csv.reader(f)
        header = next(rd)
        i_fk = col_index(header, "source_document_id")
        i_ems = col_index(header, "ems_count")
        for row in rd:
            if len(row) <= max(i_fk, i_ems):
                continue
            rdate = id2date.get(row[i_fk].strip())
            if not rdate or rdate in EXCLUDE:
                continue
            d = parse_ymd(rdate)
            if not d:
                continue
            act = d - timedelta(days=1)   # 활동일 = 발표일 - 1
            ems = try_float(row[i_ems])
            if ems is None:
                continue
            all_vals.append(ems)
            (peak_vals if act.month in (7, 8) else rest_vals).append(ems)
    if not peak_vals or not rest_vals:
        return None
    peak_mean = sum(peak_vals) / len(peak_vals)
    rest_mean = sum(rest_vals) / len(rest_vals)
    annual_mean = sum(all_vals) / len(all_vals)
    mult = peak_mean / rest_mean if rest_mean else 1.0
    # 온열 키워드 사례(정성 보조근거) — 오탐 제외
    heat_events = 0
    heat_examples = []
    if os.path.exists(ir_path):
        KW = ("온열", "폭염", "열사병", "일사병")
        FP = ("온열등", "치료기")  # 축사 난방기·온열치료기 발화 = 폭염 무관 오탐
        with open(ir_path, "r", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            header = next(rd)
            i_ty = col_index(header, "incident_type")
            i_sm = col_index(header, "summary")
            i_rg = col_index(header, "region")
            for row in rd:
                wide = max(i_ty, i_sm)
                if len(row) <= wide:
                    continue
                text = (row[i_ty] if i_ty >= 0 else "") + " " + (row[i_sm] if i_sm >= 0 else "")
                if any(k in text for k in KW) and not any(fp in text for fp in FP):
                    heat_events += 1
                    if len(heat_examples) < 3 and i_sm >= 0 and row[i_sm].strip():
                        rg = row[i_rg].strip() if i_rg >= 0 else ""
                        heat_examples.append((rg + " " + row[i_sm].strip())[:70])
    dates = sorted(v for v in id2date.values() if v)
    note = (f"소방청 일일상황보고 {len(all_vals):,}일 기준 폭염기(7~8월) 전국 구급출동이 "
            f"평시 대비 {mult:.2f}배(일평균 {peak_mean:.0f}건 vs {rest_mean:.0f}건). "
            f"온열 특정 폭증이 아닌 '구급 전반 수요 증가' 근거로 사용.")
    return {
        "summerSurgeMultiplier": round(mult, 2),
        "peakDailyEms": round(peak_mean, 1),
        "restDailyEms": round(rest_mean, 1),
        "annualDailyEms": round(annual_mean, 1),
        "validDays": len(all_vals),
        "dateRange": f"{dates[0]}~{dates[-1]}" if dates else "",
        "heatEventCount": heat_events,
        "heatExamples": heat_examples,
        "note": note,
    }


# =====================================================================
#  쉼터/출동점 (대체셋 생성 + 공통 파생)
# =====================================================================
def gen_shelters(region):
    out = []
    c = region["centroid"]
    n = max(8, int(region["shelterCount"] * 0.12))  # 표시용 대표 표본
    spread = 0.018 + math.sqrt(region["areaKm2"]) / 900.0
    for i in range(n):
        ang = random.random() * 2 * math.pi
        r = (random.random() ** 0.6) * spread * (1.4 if region["elderlyRatio"] > 0.3 else 1.0)
        out.append({
            "id": f"{region['code']}-S{i:03d}",
            "name": f"{region['name']} {random.choice(SHELTER_TYPES)} {i+1}호",
            "lat": round(c["lat"] + r * math.sin(ang), 5),
            "lng": round(c["lng"] + r * math.cos(ang) * 1.1, 5),
            "regionCode": region["code"],
            "type": random.choice(SHELTER_TYPES),
            "capacity": random.choice([20, 30, 40, 50, 60]),
            "operatingHours": "09:00~18:00",
            "isOutdoor": False,
        })
    return out


def nearest_shelter_dist(lat, lng, shelters):
    best, bid = 1e9, None
    for s in shelters:
        dx = (lng - s["lng"]) * 88.8   # 위도 35.7도 근사 km/deg
        dy = (lat - s["lat"]) * 111.0
        d = math.hypot(dx, dy) * 1000.0
        if d < best:
            best, bid = d, s["id"]
    return best, bid


def gen_synthetic(region, shelters, all_weeks):
    """대체셋: (points, weekly[weekISO]=n) 동시 생성 — 지도/예측/백테스트 일관성."""
    points, weekly = [], {}
    base = region["population"] / 1000.0 * (0.6 + region["elderlyRatio"] * 2.2)
    c = region["centroid"]
    spread = 0.02 + math.sqrt(region["areaKm2"]) / 800.0
    idx = 0
    for w in all_weeks:
        lam = base * heat_week_factor(w) * 0.02
        n = min(30, max(0, int(random.gauss(lam, max(0.8, lam * 0.45)))))
        weekly[w.isoformat()] = n
        for _ in range(n):
            ang = random.random() * 2 * math.pi
            r = (random.random() ** 0.5) * spread
            la = c["lat"] + r * math.sin(ang)
            lo = c["lng"] + r * math.cos(ang) * 1.1
            day = w + timedelta(days=random.randint(0, 6))
            dist, sid = nearest_shelter_dist(la, lo, shelters)
            ag = "elderly" if random.random() < (0.45 + region["elderlyRatio"] * 0.5) else \
                 ("adult" if random.random() < 0.7 else "child")
            points.append({
                "id": f"{region['code']}-I{idx:05d}",
                "lat": round(la, 5), "lng": round(lo, 5),
                "date": day.isoformat(), "regionCode": region["code"],
                "ageGroup": ag, "nearestShelterId": sid,
                "nearestShelterDistM": round(dist),
            })
            idx += 1
    return points, weekly


def points_from_real_weekly(region, weekly_code, shelters):
    """서울 실데이터: 좌표가 없어 자치구 실건수를 중심 근방에 시각화용 근사배치(정직성 명시)."""
    points = []
    c = region["centroid"]
    spread = 0.012 + math.sqrt(region["areaKm2"]) / 1400.0
    idx = 0
    rnd = random.Random(zlib.crc32(region["code"].encode()) & 0xFFFFFFFF)  # 좌표 근사는 권역별 결정론적(PYTHONHASHSEED 무관)
    for wk, n in sorted(weekly_code.items()):
        try:
            w0 = date.fromisoformat(wk)
        except Exception:
            continue
        for _ in range(int(n)):
            ang = rnd.random() * 2 * math.pi
            r = (rnd.random() ** 0.5) * spread
            la = c["lat"] + r * math.sin(ang)
            lo = c["lng"] + r * math.cos(ang) * 1.1
            day = w0 + timedelta(days=rnd.randint(0, 6))
            dist, sid = nearest_shelter_dist(la, lo, shelters)
            points.append({
                "id": f"{region['code']}-A{idx:05d}",
                "lat": round(la, 5), "lng": round(lo, 5),
                "date": day.isoformat(), "regionCode": region["code"],
                "ageGroup": "unknown", "nearestShelterId": sid,
                "nearestShelterDistM": round(dist),
            })
            idx += 1
    return points


# ── 예측 모델(투명한 경량 스코어) — clientEngine.ts 미러 ──────────
def build_forecasts(regions, weekly, forecast_weeks, elderly_override):
    forecasts = []
    train_all = [TRAIN_WEEK_LISTS[y][i] for y in TRAIN_YEARS for i in range(SUMMER_N)]
    for r in regions:
        wk = weekly.get(r["code"], {})
        hist_vals = [wk.get(w.isoformat(), 0) for w in train_all]
        hist_mean = sum(hist_vals) / max(1, len(hist_vals))
        hist_idx = round(normalize(hist_mean, 0.05, 4.0), 3)
        exposure_idx = round(normalize(math.log10(max(1, r["population"])), 4.3, 5.8), 3)
        if elderly_override and r["code"] in elderly_override:
            elderly_idx = elderly_override[r["code"]]
        else:
            elderly_idx = round(normalize(r["elderlyRatio"], 0.14, 0.36), 3)
        for i, w in enumerate(forecast_weeks):
            wkey = w.isoformat()
            # 계절 baseline = 학습연도들의 동일 주차 평균(실측 seasonal climatology)
            seas = [wk.get(TRAIN_WEEK_LISTS[y][i].isoformat(), 0) for y in TRAIN_YEARS]
            baseline = sum(seas) / max(1, len(seas))
            base_temp = round(heat_week_factor(w), 3)
            alert = ALERT_BY_WEEK.get(wkey, "없음")
            temp_idx = round(min(1.0, base_temp + ALERT_TEMP_DELTA[alert]), 3)
            score = max(0.0, min(1.0, W_TEMP * temp_idx + W_ELDERLY * elderly_idx +
                                 W_EXPOSURE * exposure_idx + W_HISTORY * hist_idx))
            demand = baseline * (0.85 + 0.6 * temp_idx) * (1.0 + ALERT_DEMAND_MULT[alert])
            forecasts.append({
                "regionCode": r["code"], "weekStart": wkey,
                "grade": grade_of(score),
                "expectedDemand": round(demand, 1),
                "baseline": round(baseline, 1),
                "baseTempIndex": base_temp,
                "scenarioAlert": alert,
                "components": {
                    "tempIndex": temp_idx, "elderlyIndex": elderly_idx,
                    "exposureIndex": exposure_idx, "historyIndex": hist_idx,
                },
                # 화장용 confidence 공식 제거 — 예측 신뢰는 스코프별 백테스트로 확인(UI 미노출)
                "_score": round(score, 4),
            })
    return forecasts


# ── 쉼터 공백지대 격자 ────────────────────────────────────────
def build_gap_cells(region, shelters, incidents):
    cells = []
    if not incidents:
        return cells
    las = [i["lat"] for i in incidents]
    los = [i["lng"] for i in incidents]
    minla, maxla, minlo, maxlo = min(las), max(las), min(los), max(los)
    G = 7
    dla = (maxla - minla) / G or 0.01
    dlo = (maxlo - minlo) / G or 0.01
    raw = []
    for gx in range(G):
        for gy in range(G):
            clat = minla + (gx + 0.5) * dla
            clon = minlo + (gy + 0.5) * dlo
            dens = 0.0
            for it in incidents:
                dx = (it["lng"] - clon) * 88.8
                dy = (it["lat"] - clat) * 111.0
                dens += math.exp(-(dx * dx + dy * dy) / (2 * 1.2 ** 2))
            sdist, _ = nearest_shelter_dist(clat, clon, shelters)
            raw.append([clat, clon, dens, sdist])
    max_dens = max((x[2] for x in raw), default=1.0) or 1.0
    for k, (clat, clon, dens, sdist) in enumerate(raw):
        nd = dens / max_dens
        ndist = min(1.0, sdist / 2500.0)
        gap = round(nd * 0.55 + ndist * 0.45, 3)
        cells.append({
            "id": f"{region['code']}-G{k:02d}",
            "lat": round(clat, 5), "lng": round(clon, 5),
            "regionCode": region["code"],
            "incidentDensity": round(nd, 3),
            "nearestShelterDistM": round(sdist),
            "gapScore": gap,
            "isBlindSpot": bool(nd > 0.45 and sdist > 900),
        })
    return cells


# ── 취약 우선동(집계) ─────────────────────────────────────────
def build_priority_dongs(region, elderly_signal=None):
    dongs = JEONBUK_DONGS.get(region["code"])
    if not dongs:
        dongs = [f"{region['name']} {i+1}동" for i in range(4)]
    # 서울 실데이터: 자치구 실측 고령신호를 기저로(집계 단위, 개인 아님)
    base_eld = None
    if elderly_signal is not None:
        base_eld = elderly_signal
    rnd = random.Random(zlib.crc32(region["code"].encode()) & 0x7FFFFFFF)
    out = []
    for dn in dongs:
        if base_eld is not None:
            eld = min(1.0, base_eld * (0.9 + 0.25 * rnd.random()))
        else:
            eld = min(1.0, region["elderlyRatio"] * (1.1 + 0.5 * rnd.random()))
        trend = rnd.random()
        access = rnd.random()
        vuln = round(0.5 * eld + 0.3 * trend + 0.2 * access, 3)
        out.append({
            "regionCode": region["code"], "dongName": dn,
            "vulnIndex": vuln, "elderlyDensity": round(eld, 3), "rank": 0,
        })
    out.sort(key=lambda x: -x["vulnIndex"])
    for i, d in enumerate(out):
        d["rank"] = i + 1
    return out[:5]


# ── 선배치 권고 ───────────────────────────────────────────────
def build_deploy_recs(regions, forecasts, target_week, blind_by_region):
    recs = []
    fmap = {(f["regionCode"], f["weekStart"]): f for f in forecasts}
    for r in regions:
        f = fmap.get((r["code"], target_week))
        if not f:
            continue
        surge = round(f["expectedDemand"] - f["baseline"], 1)
        blind = blind_by_region.get(r["code"], 0)
        if f["grade"] in ("경계", "심각") and f["expectedDemand"] >= 5:
            action = "구급차 선배치 + 쉼터 개방시간 연장(수요 급증 권역)"
        elif f["grade"] in ("경계", "심각"):
            action = "취약 우선동 선제 안부 + 쉼터 공백지대 보강(고령 취약·쉼터 원거리)"
        elif f["grade"] == "주의":
            action = "쉼터 운영 점검 + 공백지대 모니터링"
        else:
            action = "평시 모니터링"
        recs.append({
            "regionCode": r["code"], "regionName": r["name"], "grade": f["grade"],
            "expectedDemand": f["expectedDemand"], "baseline": f["baseline"],
            "surge": surge, "blindSpots": blind, "gap": surge, "action": action,
            "priority": round(f["_score"] * 100 + max(0, surge) * 8 + blind * 2, 1),
        })
    recs.sort(key=lambda x: -x["priority"])
    return recs


# ── 자동 브리핑 ───────────────────────────────────────────────
def build_briefings(regions, forecasts, target_week):
    fmap = {(f["regionCode"], f["weekStart"]): f for f in forecasts}
    out = []
    for r in regions:
        f = fmap.get((r["code"], target_week))
        if not f:
            continue
        g = f["grade"]
        head = f"[{r['name']}] {target_week} 주간 온열 구급수요 '{g}'"
        body = (f"예측 {f['expectedDemand']}건(평년 {f['baseline']}건 대비 "
                f"{'+' if f['expectedDemand'] >= f['baseline'] else ''}"
                f"{round((f['expectedDemand']-f['baseline'])/max(0.1,f['baseline'])*100):d}%). "
                f"고령 취약 노출 {round(f['components']['elderlyIndex']*100)}p, "
                f"기온/특보 요인 {round(f['components']['tempIndex']*100)}p.")
        bullets = []
        if g in ("경계", "심각"):
            bullets.append("구급차 선배치 및 쉼터 개방시간 연장 검토")
            bullets.append("취약 우선동 대상 선제 안부·예방 안내")
        elif g == "주의":
            bullets.append("쉼터 운영 점검 및 공백지대 우선 보강")
        else:
            bullets.append("평시 모니터링 유지")
        bullets.append("쉼터 공백지대(출동밀도高·쉼터距離遠) 신규 입지 후보 검토")
        out.append({
            "regionCode": r["code"], "weekStart": target_week, "grade": g,
            "headline": head, "body": body, "bullets": bullets,
        })
    return out


# ── 백테스팅(holdout: 학습 2017~2021 → 예측 2022 → 실측 비교) ────
def _auc(probs, labels):
    pos = [p for p, l in zip(probs, labels) if l == 1]
    neg = [p for p, l in zip(probs, labels) if l == 0]
    if not pos or not neg:
        return 0.5
    wins = 0.0
    for pp in pos:
        for nn in neg:
            wins += 1.0 if pp > nn else (0.5 if pp == nn else 0.0)
    return wins / (len(pos) * len(neg))


def backtest_holdout(regions, weekly, pilot, source):
    metrics = []
    all_pred, all_base, all_act, all_prob, all_label = [], [], [], [], []
    week_rows = defaultdict(list)  # weekISO -> [(code, pred, act)] for precision@k
    real = (source == "real")
    tag = "실측 홀드아웃" if real else "합성 홀드아웃"
    for r in regions:
        wk = weekly.get(r["code"], {})
        train_vals = [wk.get(TRAIN_WEEK_LISTS[y][i].isoformat(), 0)
                      for y in TRAIN_YEARS for i in range(SUMMER_N)]
        test_vals = [wk.get(w.isoformat(), 0) for w in FORECAST_WEEKS]
        pool = sorted(train_vals + test_vals)
        hi_cut = max(1, pool[int(len(pool) * 0.66)]) if pool else 1
        flat_mean = sum(train_vals) / max(1, len(train_vals))  # naive baseline predictor
        preds, acts, probs, labels = [], [], [], []
        for i, w in enumerate(FORECAST_WEEKS):
            seas = [wk.get(TRAIN_WEEK_LISTS[y][i].isoformat(), 0) for y in TRAIN_YEARS]
            seas_mean = sum(seas) / max(1, len(seas))          # train-only seasonal climatology
            alert = ALERT_BY_WEEK.get(w.isoformat(), "없음")
            tf = min(1.0, heat_week_factor(w) + ALERT_TEMP_DELTA[alert])
            # 희소 카운트 방어: 계절 climatology와 flat 평균의 shrinkage 블렌드(leakage 없음)
            pred = max(0.0, 0.5 * seas_mean + 0.5 * flat_mean)
            act = wk.get(w.isoformat(), 0)
            preds.append(pred); acts.append(act)
            probs.append(min(1.0, tf * 0.6 + normalize(seas_mean, 0.1, 5.0) * 0.4))
            labels.append(1 if act >= hi_cut else 0)
            week_rows[w.isoformat()].append((r["code"], pred, act))
            all_pred.append(pred); all_base.append(flat_mean); all_act.append(act)
            all_prob.append(probs[-1]); all_label.append(labels[-1])
        if not acts:
            continue
        mae = sum(abs(p - a) for p, a in zip(preds, acts)) / len(acts)
        base_mae = sum(abs(flat_mean - a) for a in acts) / len(acts)
        brier = sum((pr - la) ** 2 for pr, la in zip(probs, labels)) / len(labels)
        metrics.append({
            "scope": r["code"], "scopeName": f"{r['name']}({tag})",
            "auc": round(_auc(probs, labels), 3), "mae": round(mae, 2),
            "brier": round(brier, 3), "baselineMae": round(base_mae, 2),
            "improvement": round((base_mae - mae) / base_mae, 3) if base_mae > 0 else 0,
            "n": len(acts), "period": f"{FORECAST_WEEKS[0]}~{FORECAST_WEEKS[-1]}",
            "metricKind": "weekly",
        })
    if all_act:
        mae = sum(abs(p - a) for p, a in zip(all_pred, all_act)) / len(all_act)
        base_mae = sum(abs(b - a) for b, a in zip(all_base, all_act)) / len(all_act)
        brier = sum((pr - la) ** 2 for pr, la in zip(all_prob, all_label)) / len(all_label)
        k = 3
        precs = []
        for wkey, rows in week_rows.items():
            if len(rows) < k or sum(a for _, _, a in rows) == 0:
                continue
            pred_top = set(c for c, _, _ in sorted(rows, key=lambda x: -x[1])[:k])
            act_top = set(c for c, _, _ in sorted(rows, key=lambda x: -x[2])[:k])
            precs.append(len(pred_top & act_top) / k)
        prec_at_k = round(sum(precs) / len(precs), 3) if precs else 0
        if real:
            scope_name = f"{pilot} 온열 자치구×주 holdout({FORECAST_YEAR} 실측·희소사건)"
        else:
            scope_name = f"{pilot} 전체(생활권-주, {FORECAST_YEAR} 합성 홀드아웃)"
        metrics.insert(0, {
            "scope": f"overall:{pilot}", "scopeName": scope_name,
            "auc": round(_auc(all_prob, all_label), 3), "mae": round(mae, 2),
            "brier": round(brier, 3), "baselineMae": round(base_mae, 2),
            "improvement": round((base_mae - mae) / base_mae, 3) if base_mae > 0 else 0,
            "precisionAtK": prec_at_k, "k": k,
            "n": len(all_act), "period": f"{FORECAST_WEEKS[0]}~{FORECAST_WEEKS[-1]}",
            "metricKind": "weekly",
        })
    return metrics


def backtest_vulnerability(regions, elderly, pilot):
    """취약도 랭킹 holdout(실측): 고령 EMS per-capita 부하로 학습(2017~2021)한 자치구 취약순위가
    이듬해(2022) 실측 순위를 예측하는지 검증. 온열 구급이 희소사건이라 정밀예측이 어려운 반면,
    '어디를 상시 대비할 것인가'(구조적 취약지 타겟팅)는 강하게 예측가능함을 실측으로 입증.
    (서울·전북 공용 — pilot 라벨만 분기)"""
    tr, te = elderly.get("train"), elderly.get("test")
    if not tr or not te:
        return None
    pop = {r["code"]: r["population"] for r in regions}
    tr_pc = {r["code"]: tr.get(r["code"], 0) / max(1.0, pop[r["code"]] / 1000.0) for r in regions}
    te_pc = {r["code"]: te.get(r["code"], 0) / max(1.0, pop[r["code"]] / 1000.0) for r in regions}
    codes = [r["code"] for r in regions]
    # 정규화(순위 무관 스케일)
    tvals = list(tr_pc.values()); lo, hi = min(tvals), max(tvals)
    evals = list(te_pc.values()); elo, ehi = min(evals), max(evals)
    pred = {c: normalize(tr_pc[c], lo, hi) for c in codes}
    act = {c: normalize(te_pc[c], elo, ehi) for c in codes}
    # precision@k (상위 취약 자치구 적중)
    pr = sorted(codes, key=lambda c: -tr_pc[c])
    ar = sorted(codes, key=lambda c: -te_pc[c])
    k = 5
    prec = len(set(pr[:k]) & set(ar[:k])) / k
    # 회귀 지표: 정규화 취약지수 예측 오차 vs 평균 베이스라인
    mean_act = sum(act.values()) / len(act)
    mae = sum(abs(pred[c] - act[c]) for c in codes) / len(codes)
    base_mae = sum(abs(mean_act - act[c]) for c in codes) / len(codes)
    # 분류 지표: 상위 1/3 취약 자치구 판별
    thr = sorted(te_pc.values())[int(len(codes) * 0.66)]
    labels = [1 if te_pc[c] >= thr else 0 for c in codes]
    probs = [pred[c] for c in codes]
    brier = sum((p - l) ** 2 for p, l in zip(probs, labels)) / len(codes)
    return {
        "scope": f"vuln:{pilot}",
        "scopeName": f"{pilot} 취약도 랭킹 검증(고령EMS per-capita, 2017-21학습→2022실측)",
        "auc": round(_auc(probs, labels), 3),
        "mae": round(mae, 3), "brier": round(brier, 3),
        "baselineMae": round(base_mae, 3),
        "improvement": round((base_mae - mae) / base_mae, 3) if base_mae > 0 else 0,
        "precisionAtK": round(prec, 3), "k": k,
        "n": len(codes), "period": "2017-2021 → 2022",
        "metricKind": "vuln",
    }


# =====================================================================
#  파일럿 조립
# =====================================================================
def build_pilot(pilot, regions, weekly, real_points, elderly_override, real_shelters, source, elderly=None):
    all_weeks = [w for y in TRAIN_YEARS for w in TRAIN_WEEK_LISTS[y]] + list(FORECAST_WEEKS)
    # shelters_by_region = 거리계산 기준(권역 귀속 전량). display_shelters = 번들 표시용 결정론적 표본(상한).
    shelters_by_region, full_shelters = {}, []
    region_real = 0
    for r in regions:
        rs = [s for s in (real_shelters or []) if s["regionCode"] == r["code"]]
        # 최소 임계 가드: 권역 실쉼터가 MIN_REAL_SHELTERS 미만이면 합성 표본 유지
        use_real = len(rs) >= MIN_REAL_SHELTERS
        sh = rs if use_real else gen_shelters(r)
        if use_real:
            region_real += 1
        shelters_by_region[r["code"]] = sh   # 전량 — 최근접거리·공백지대 격자 정확도 기준
        full_shelters += sh
    shelter_real = bool(real_shelters) and region_real > 0
    # 표시 상한: 파일럿당 MAX_DISPLAY_SHELTERS_PER_PILOT (결정론적 표본, 전량은 거리계산이 이미 사용)
    display_shelters = full_shelters
    if len(full_shelters) > MAX_DISPLAY_SHELTERS_PER_PILOT:
        rnd = random.Random(zlib.crc32(("shelterdisp:" + pilot).encode()) & 0xFFFFFFFF)
        display_shelters = rnd.sample(full_shelters, MAX_DISPLAY_SHELTERS_PER_PILOT)
        display_shelters.sort(key=lambda s: s["id"])  # 번들 내 순서 안정화(비트 재현성)
    shelters = display_shelters

    incidents = []
    weekly = dict(weekly) if weekly else {}
    if source == "real":
        # 서울: 실측 weekly → 근사 출동점 / 전북: 실좌표 출동점
        if real_points:
            incidents = list(real_points)
            # 실좌표 출동점에 최근접 쉼터 부여
            for p in incidents:
                if p.get("nearestShelterId") is None:
                    d, sid = nearest_shelter_dist(p["lat"], p["lng"], shelters_by_region.get(p["regionCode"], []))
                    p["nearestShelterId"] = sid
                    p["nearestShelterDistM"] = round(d)
        else:
            for r in regions:
                incidents += points_from_real_weekly(r, weekly.get(r["code"], {}), shelters_by_region[r["code"]])
    else:
        weekly = {}
        for r in regions:
            pts, wcnt = gen_synthetic(r, shelters_by_region[r["code"]], all_weeks)
            incidents += pts
            weekly[r["code"]] = wcnt

    forecasts = build_forecasts(regions, weekly, FORECAST_WEEKS, elderly_override)
    inc_by_region = defaultdict(list)
    for it in incidents:
        inc_by_region[it["regionCode"]].append(it)
    gap_cells, priority_dongs = [], []
    for r in regions:
        gap_cells += build_gap_cells(r, shelters_by_region[r["code"]], inc_by_region[r["code"]])
        esig = elderly_override.get(r["code"]) if elderly_override else None
        priority_dongs += build_priority_dongs(r, esig)

    target_week = max(FORECAST_WEEKS, key=heat_week_factor).isoformat()
    blind_by_region = {}
    for c in gap_cells:
        if c["isBlindSpot"]:
            blind_by_region[c["regionCode"]] = blind_by_region.get(c["regionCode"], 0) + 1
    deploy_recs = build_deploy_recs(regions, forecasts, target_week, blind_by_region)
    briefings = build_briefings(regions, forecasts, target_week)
    bt = backtest_holdout(regions, weekly, pilot, source)
    if source == "real" and elderly:
        vb = backtest_vulnerability(regions, elderly, pilot)
        if vb:
            bt.append(vb)
    return {
        "shelters": shelters, "incidents": incidents, "forecasts": forecasts,
        "gapCells": gap_cells, "priorityDongs": priority_dongs,
        "deployRecs": deploy_recs, "briefings": briefings, "backtest": bt,
        "target_week": target_week, "weekly": weekly,
        "shelterDisplayCount": len(display_shelters),
        "shelterTotalCount": len(full_shelters),
        "shelterReal": shelter_real,
    }


def main():
    seed = load_seed()
    raw = find_raw()

    # ── 전국 컨텍스트(일일상황보고) ──
    natl = national_context(raw["daily_dir"])
    natl_examples = []
    if natl:
        # 원문 PDF 발췌(주소·장소 포함)는 공개 전 review 대상 → 번들에는 미탑재(집계수치만 공개)
        natl_examples = natl.pop("heatExamples", [])

    # ── 서울 실데이터 인제스트 ──
    seoul_regions = seed["서울"]
    seoul_source = "sample"
    seoul_weekly, seoul_stats = {}, {}
    seoul_elderly_override = None
    seoul_elderly_stats = {}
    if raw["seoul_heat"]:
        seoul_weekly, seoul_stats = ingest_seoul_heat(raw["seoul_heat"], seoul_regions)
        seoul_source = "real" if seoul_stats.get("kept", 0) > 0 else "sample"
    if raw["seoul_elderly"]:
        seoul_elderly_stats = ingest_elderly(raw["seoul_elderly"], seoul_regions)
        seoul_elderly_override = elderly_index_from_signal(seoul_regions, seoul_elderly_stats)

    # ── 전북 실데이터 인제스트 ──
    jeonbuk_regions = seed["전북"]
    jeonbuk_source = "sample"
    jeonbuk_weekly, jeonbuk_points, jeonbuk_stats = {}, [], {}
    jeonbuk_elderly_override = None
    jeonbuk_elderly_stats = {}
    if raw["jeonbuk_heat"]:
        jeonbuk_weekly, jeonbuk_points, jeonbuk_stats = ingest_jeonbuk_heat(raw["jeonbuk_heat"], jeonbuk_regions)
        jeonbuk_source = "real" if jeonbuk_stats.get("kept", 0) > 0 else "sample"
    if raw["jeonbuk_elderly"]:
        jeonbuk_elderly_stats = ingest_elderly(raw["jeonbuk_elderly"], jeonbuk_regions)
        jeonbuk_elderly_override = elderly_index_from_signal(jeonbuk_regions, jeonbuk_elderly_stats)

    # ── 쉼터 실좌표(도착 시 — '표본' 파일은 find_raw 단계에서 이미 제외) ──
    shelter_stats = {}
    if raw["shelter"]:
        real_shelters, shelter_stats = ingest_shelters(raw["shelter"], jeonbuk_regions + seoul_regions)
    else:
        real_shelters = []
    shelter_by_pilot = {"전북": [], "서울": []}
    for s in real_shelters:
        if any(r["code"] == s["regionCode"] for r in jeonbuk_regions):
            shelter_by_pilot["전북"].append(s)
        else:
            shelter_by_pilot["서울"].append(s)

    # ── 파일럿 조립 ──
    pilots = {
        "전북": build_pilot("전북", jeonbuk_regions, jeonbuk_weekly, jeonbuk_points,
                           jeonbuk_elderly_override, shelter_by_pilot["전북"], jeonbuk_source,
                           elderly=jeonbuk_elderly_stats),
        "서울": build_pilot("서울", seoul_regions, seoul_weekly, None,
                           seoul_elderly_override, shelter_by_pilot["서울"], seoul_source,
                           elderly=seoul_elderly_stats),
    }

    all_regions = jeonbuk_regions + seoul_regions
    shelters, incidents, forecasts = [], [], []
    gap_cells, priority_dongs, deploy_recs, briefings, backtest_all = [], [], [], [], []
    for pilot in ("전북", "서울"):
        o = pilots[pilot]
        shelters += o["shelters"]; incidents += o["incidents"]; forecasts += o["forecasts"]
        gap_cells += o["gapCells"]; priority_dongs += o["priorityDongs"]
        deploy_recs += o["deployRecs"]; briefings += o["briefings"]; backtest_all += o["backtest"]
    target_week = max(FORECAST_WEEKS, key=heat_week_factor).isoformat()

    # ── 개인정보 보호 + 출력 크기 상한 ──
    total_inc = len(incidents)
    sample_inc = incidents
    if len(sample_inc) > 3000:
        sample_inc = random.sample(sample_inc, 3000)
    sample_inc = [
        {"id": it["id"], "regionCode": it["regionCode"],
         "lat": round(it["lat"], 3), "lng": round(it["lng"], 3),   # ~110m 격자 스냅(재식별 차단)
         "date": it["date"], "ageGroup": it.get("ageGroup", "unknown"),
         "nearestShelterId": None,
         "nearestShelterDistM": it.get("nearestShelterDistM")}
        for it in sample_inc
    ]

    source_by_pilot = {"전북": jeonbuk_source, "서울": seoul_source}
    _real_ct = sum(1 for v in source_by_pilot.values() if v == "real")
    data_source = "real" if _real_ct == len(source_by_pilot) else ("sample" if _real_ct == 0 else "mixed")

    # ── 쉼터 소스 메타(UI 문구 조건부 전환용) ──
    shelter_real_by_pilot = {"전북": bool(pilots["전북"]["shelterReal"]),
                             "서울": bool(pilots["서울"]["shelterReal"])}
    if real_shelters:
        shelter_source = (f"real(행안부 무더위쉼터 전량, safemap IF_0001, 전국 "
                          f"{shelter_stats.get('rowsRead', 0):,}개소 인제스트)")
    else:
        shelter_source = "synthetic"
    shelter_total_count = pilots["전북"]["shelterTotalCount"] + pilots["서울"]["shelterTotalCount"]
    shelter_display_count = len(shelters)

    # ── notes(정직성) ──
    notes = []
    # ── 전북(메인) ──
    if jeonbuk_source == "real":
        _jvb = next((m for m in pilots["전북"]["backtest"] if m["scope"] == "vuln:전북"), None)
        _jhb = next((m for m in pilots["전북"]["backtest"] if m["scope"] == "overall:전북"), None)
        notes.append(
            f"전북 파일럿=실데이터(메인): 전라북도 온열질환 구급출동(원본 {jeonbuk_stats.get('total',0)}건, 2014~2022) 중 "
            f"여름 15주 창(2017~2022 고온기) {jeonbuk_stats.get('kept',0)}건을 실좌표 출동점 {jeonbuk_stats.get('points',0)}개로 인제스트"
            f"(연중 데이터라 한랭 등 비여름 기록은 폭염 콘솔에서 제외). 실좌표 기반으로 출동 히트맵·쉼터 공백지대 격자를 "
            f"실계산(좌표는 소수 3자리 스냅으로 재식별 차단).")
        _ts = jeonbuk_stats.get("tempStats")
        if _ts:
            notes.append(
                f"전북 온열 출동시점(여름) 시간단위 기온: 중앙값 {_ts['median']}℃ · 33℃↑ {_ts['pct33']}% "
                f"(30℃↑ {_ts['pct30']}%, n={_ts['n']}) — 온열 출동의 고온 편중을 실측으로 확인.")
        if jeonbuk_elderly_stats.get("rowsSeen"):
            notes.append(
                f"전북 고령 취약지표=실데이터: 고령자 안전사고 구급출동 {jeonbuk_elderly_stats['rowsSeen']:,}행 "
                f"스트리밍 집계로 시군 고령EMS 부하(인구천명당)를 census 고령비율과 5:5 블렌딩(학습연도만, leak-free).")
        if _jvb and _jhb:
            notes.append(
                f"[전북 실측 검증] 온열 구급은 희소사건이라 시군×주 정밀 예측은 제한적(AUC {_jhb['auc']}, "
                f"개선 {round(_jhb['improvement']*100)}%). 반면 취약도 랭킹(구조적 취약지 상시 타겟팅)은 강함: "
                f"고령EMS 취약순위 holdout precision@{_jvb['k']}={_jvb['precisionAtK']}, AUC {_jvb['auc']}"
                f"(2017-21학습→2022실측). → 서울과 동일 방법론으로 전북에서도 '광역 대비 + 취약지 상시 집중' 가치 재현.")
    else:
        notes.append("전북 파일럿=공개통계 기반 grounded 대체셋(sample). 전라북도 온열질환 구급출동 실CSV를 "
                     "_data_raw에 넣고 재실행하면 실좌표 출동점·시간단위 기온 기반으로 real 전환됩니다.")
    # ── 서울(검증) ──
    if seoul_source == "real":
        _kept = seoul_stats.get("kept", 0)
        _tot = seoul_stats.get("total", 0)
        notes.append(f"서울 파일럿=실데이터(검증): 서울소방재난본부 온열질환 구급출동 여름 15주 창 기준 {_kept}건"
                     f"(원본 {_tot}건)을 자치구×주(週)로 집계. 학습 2017~2021 → 예측 {FORECAST_YEAR} 여름 → 실측 "
                     f"비교(holdout 백테스트). 서울 원자료에 좌표가 없어 지도 출동점은 자치구 단위 실건수의 "
                     f"'시각화용 근사배치'이며 격자 좌표는 근사임(집계 수치는 실측).")
        if seoul_elderly_override:
            notes.append(f"서울 고령 취약지표=실데이터: 고령자 안전사고 구급출동 {seoul_elderly_stats.get('rowsSeen',0):,}행 "
                         f"스트리밍 집계로 자치구 고령EMS 부하(인구천명당)를 census 고령비율과 5:5 블렌딩(학습연도만).")
        _vb = next((m for m in pilots["서울"]["backtest"] if m["scope"] == "vuln:서울"), None)
        _hb = next((m for m in pilots["서울"]["backtest"] if m["scope"] == "overall:서울"), None)
        if _vb and _hb:
            notes.append(
                f"[서울 실측 검증] 온열 구급은 연 50~104건/서울 규모의 희소사건이라 자치구×주 정밀 예측은 "
                f"평년 수준에 그침(AUC {_hb['auc']}, 개선 {round(_hb['improvement']*100)}%). 반면 고령EMS "
                f"취약순위 holdout은 precision@{_vb['k']}={_vb['precisionAtK']}, AUC {_vb['auc']}로 강함"
                f"(2017-21학습→2022실측).")
    else:
        notes.append("서울 파일럿=대체셋(실CSV 미인식).")
    # ── 쉼터(실좌표 전량 기반, H2) ──
    if real_shelters:
        _natl_total = shelter_stats.get("rowsRead", 0)
        _jb_full = pilots["전북"]["shelterTotalCount"]
        _se_full = pilots["서울"]["shelterTotalCount"]
        _jb_disp = pilots["전북"]["shelterDisplayCount"]
        _se_disp = pilots["서울"]["shelterDisplayCount"]
        notes.append(
            f"무더위쉼터=실좌표(행안부 무더위쉼터 전량, 전국 {_natl_total:,}개소 스트리밍 인제스트 중 파일럿 귀속분): "
            f"전북 {_jb_full:,}개소·서울 {_se_full:,}개소를 최근접 생활권에 귀속(도로명주소 앞토큰 선필터 + 0.25° 가드). "
            f"이용가능인원·야간/주말 운영·유형을 실값으로 매핑. 출동 히트맵의 최근접쉼터거리와 쉼터 공백지대 격자는 "
            f"이 실좌표 전량 기준으로 계산한다.")
        notes.append(
            f"지도에 담는 쉼터는 성능·용량을 위해 결정론적 표본만 표시(전북 표시 {_jb_disp}/전량 {_jb_full:,}, "
            f"서울 표시 {_se_disp}/전량 {_se_full:,}) — 거리·공백지대 계산은 전량 기준이므로 표본 축약이 최근접거리·공백지대에 영향 없음.")
    else:
        _ex = len(raw.get("shelter_excluded", []))
        notes.append(f"무더위쉼터=합성 표본(실좌표 데이터 연동 예정). 지도 쉼터 위치·공백지대 최근접거리는 합성 "
                     f"위치 기반 근사입니다. 도착한 쉼터 파일 {_ex}종은 소수 표본(미터 정밀도 오귀속 방지 위해 "
                     f"승격 제외) — 전량 표준데이터 도착 시 실좌표로 전환.")
    if natl:
        notes.append("전국 컨텍스트: " + natl["note"])

    sources = [
        "소방안전 빅데이터 플랫폼: 전라북도 온열질환 구급출동 현황(실좌표·시간단위 기온, 2014~2022)",
        "소방안전 빅데이터 플랫폼: 전라북도 고령자 안전사고 구급출동 현황(2011~2022)",
        "소방안전 빅데이터 플랫폼: 서울소방재난본부_온열질환/고령자 구급출동 현황",
        "소방안전 빅데이터 플랫폼/소방청: 일일상황보고 정형 패키지(daily119)",
        "기상청 API허브 폭염특보·예보기온 / 에어코리아 대기지수 / 통계청 SGIS 고령인구",
    ]

    bundle = {
        "generatedAt": date.today().isoformat(),
        "dataSource": data_source,
        "pilotRegion": "전북",
        "notes": notes,
        "regions": all_regions,
        "shelters": shelters,
        "incidents": sample_inc,
        "forecasts": forecasts,
        "gapCells": gap_cells,
        "priorityDongs": priority_dongs,
        "deployRecs": deploy_recs,
        "prebriefings": briefings,
        "backtest": backtest_all,
        "meta": {
            "weeks": [w.isoformat() for w in FORECAST_WEEKS],
            "defaultWeek": target_week,
            "forecastYear": FORECAST_YEAR,
            "trainYears": TRAIN_YEARS,
            "incidentCount": total_inc,
            "shelterCount": len(shelters),
            "dateRange": f"{summer_weeks(TRAIN_YEARS[0])[0]}~{FORECAST_WEEKS[-1]}",
            "sources": sources,
            "sourceByPilot": source_by_pilot,
            "shelterSource": shelter_source,
            "shelterRealByPilot": shelter_real_by_pilot,
            "shelterTotalCount": shelter_total_count,
            "shelterDisplayCount": shelter_display_count,
            "nationalContext": natl,
        },
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"OK dataSource={data_source} sourceByPilot={source_by_pilot} "
          f"regions={len(all_regions)} shelters={len(shelters)} incidents={total_inc} "
          f"(sampled {len(sample_inc)}) forecasts={len(forecasts)} gapCells={len(gap_cells)} "
          f"backtest={len(backtest_all)} size={size_mb:.2f}MB -> {OUT}")
    print(f"   [find_raw] jeonbuk_heat={len(raw['jeonbuk_heat'])} jeonbuk_elderly={len(raw['jeonbuk_elderly'])} "
          f"seoul_heat={len(raw['seoul_heat'])} seoul_elderly={len(raw['seoul_elderly'])} "
          f"shelter={len(raw['shelter'])} shelter_excluded(표본)={len(raw['shelter_excluded'])}")
    if real_shelters:
        print(f"   [쉼터 real] rowsRead={shelter_stats.get('rowsRead')} kept={shelter_stats.get('kept')} "
              f"byPilot={shelter_stats.get('byPilot')} droppedAddr={shelter_stats.get('droppedAddr')} "
              f"droppedCoord={shelter_stats.get('droppedCoord')} droppedRegionGuard={shelter_stats.get('droppedRegionGuard')}")
        print(f"   [쉼터 표시] source={shelter_source} total(거리계산)={shelter_total_count} "
              f"display(번들)={shelter_display_count} realByPilot={shelter_real_by_pilot} "
              f"전북 표시{pilots['전북']['shelterDisplayCount']}/전량{pilots['전북']['shelterTotalCount']} "
              f"서울 표시{pilots['서울']['shelterDisplayCount']}/전량{pilots['서울']['shelterTotalCount']}")
    else:
        print(f"   [쉼터] 실좌표 없음 → 합성 표본 유지 shelters={len(shelters)}")
    if jeonbuk_source == "real":
        _jts = jeonbuk_stats.get("tempStats") or {}
        print(f"   [전북 real] heatPoints={jeonbuk_stats.get('points')} 원본={jeonbuk_stats.get('total')} "
              f"여름kept={jeonbuk_stats.get('kept')} ctpvDrop={jeonbuk_stats.get('ctpvDrop')} "
              f"summerByYear={jeonbuk_stats.get('summerByYear')} tempMedian={_jts.get('median','-')} "
              f"pct33={_jts.get('pct33','-')} elderlyRows={jeonbuk_elderly_stats.get('rowsSeen','-')}")
    if seoul_source == "real":
        print(f"   [서울 실측] heatKept={seoul_stats.get('kept')} 원본={seoul_stats.get('total')} "
              f"droppedNonSeoul={seoul_stats.get('droppedNonSeoul')} "
              f"elderlyRows={seoul_elderly_stats.get('rowsSeen','-')}")
    if natl:
        print(f"   [전국] 폭염기 구급 급증 배수={natl['summerSurgeMultiplier']} "
              f"(7~8월 {natl['peakDailyEms']} vs 평시 {natl['restDailyEms']}건/일), "
              f"온열 키워드 사례={natl['heatEventCount']}건")
    for m in backtest_all:
        if m["scope"].startswith("overall") or m["scope"].startswith("vuln"):
            print(f"   {m['scopeName']}: AUC={m['auc']} MAE={m['mae']} (baseline {m['baselineMae']}, "
                  f"개선 {round(m['improvement']*100)}%) precision@{m.get('k','-')}={m.get('precisionAtK','-')} n={m['n']}")


if __name__ == "__main__":
    main()
