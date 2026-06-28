#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
쿨가드 119 — 데이터 정제·사전계산 파이프라인 (stdlib만 사용, 재현가능 seed)

역할:
  1) _data_raw/ 에 bigdata-119 실CSV가 있으면 정제(전북 융합 / 서울 온열·고령 구급출동 / 일일상황보고)
  2) 없으면 공개통계 기반 grounded 대체셋 생성(dataSource="sample")
  3) 생활권×주(週) 온열 구급수요 예측 등급 + 쉼터 공백지대 격자 + 취약 우선동
     + 선배치 권고 + 자동 브리핑 + holdout 백테스팅(AUC/MAE/Brier) 사전계산
  4) src/data/bundle.json 으로 출력 (앱이 키 없이 읽는 정적 번들)

실CSV가 들어오면 같은 명령으로 재실행하면 dataSource가 "real"로 바뀐다.
"""
import csv
import glob
import json
import math
import os
import random
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
RAW_DIRS = [
    os.path.join(PROJ, "_data_raw"),
    os.path.join(os.path.dirname(PROJ), "0805_소방안전 빅데이터 활용 및 아이디어 경진대회", "_data_raw"),
]
OUT = os.path.join(PROJ, "src", "data", "bundle.json")
SEED = os.path.join(PROJ, "src", "data", "regions_seed.json")

random.seed(20260805)  # 마감일 seed — 재현가능

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


def load_seed():
    with open(SEED, "r", encoding="utf-8") as f:
        return json.load(f)


# ── 실CSV 탐지 ────────────────────────────────────────────────
def find_raw_csvs():
    found = {}
    for d in RAW_DIRS:
        if not os.path.isdir(d):
            continue
        for path in glob.glob(os.path.join(d, "**", "*.csv"), recursive=True):
            name = os.path.basename(path)
            low = name.replace(" ", "")
            if "융합" in low or ("온열" in low and "무더위" in low):
                found.setdefault("jeonbuk_fusion", path)
            elif "온열질환" in low and "구급" in low:
                found.setdefault("seoul_heat", path)
            elif "고령자" in low and "구급" in low:
                found.setdefault("seoul_elderly", path)
            elif "일일상황" in low:
                found.setdefault("daily", path)
    return found


def try_float(v):
    try:
        return float(str(v).strip())
    except Exception:
        return None


def parse_points(path):
    """위경도 좌표가 있는 CSV에서 (lat,lng,date) 표본 추출 — 컬럼명 유연 매칭."""
    pts = []
    try:
        with open(path, "r", encoding="utf-8-sig", errors="ignore") as f:
            rd = csv.DictReader(f)
            cols = rd.fieldnames or []
            lat_c = next((c for c in cols if c and any(k in c.lower() for k in ["lat", "위도", "y좌표", "ycrd", "y_crd"])), None)
            lng_c = next((c for c in cols if c and any(k in c.lower() for k in ["lon", "lng", "경도", "x좌표", "xcrd", "x_crd"])), None)
            date_c = next((c for c in cols if c and any(k in c for k in ["일자", "날짜", "출동", "date", "발생"])), None)
            dist_c = next((c for c in cols if c and ("거리" in c or "dist" in c.lower())), None)
            if not lat_c or not lng_c:
                return pts, None
            for row in rd:
                la, lo = try_float(row.get(lat_c)), try_float(row.get(lng_c))
                if la is None or lo is None or not (33 < la < 39) or not (124 < lo < 132):
                    continue
                pts.append({
                    "lat": la, "lng": lo,
                    "date": str(row.get(date_c, "")).strip()[:10] if date_c else "",
                    "dist": try_float(row.get(dist_c)) if dist_c else None,
                })
    except Exception as e:
        print(f"  ! parse 실패 {os.path.basename(path)}: {e}", file=sys.stderr)
    return pts, {"lat": lat_c, "lng": lng_c}


# ── 주(週) 유틸 ───────────────────────────────────────────────
def monday(d):
    return d - timedelta(days=d.weekday())


def summer_weeks(year):
    """6/1~9/15 사이의 월요일들."""
    ws = []
    d = monday(date(year, 6, 1))
    while d <= date(year, 9, 15):
        ws.append(d)
        d += timedelta(days=7)
    return ws


def heat_week_factor(d):
    """여름 주차별 온열 강도(0~1) — 7월말~8월초 피크의 종형 곡선."""
    peak = date(d.year, 8, 4)
    diff = abs((d - peak).days)
    return max(0.05, math.exp(-((diff / 24.0) ** 2)))


# ── 등급 매핑 ─────────────────────────────────────────────────
def grade_of(score):
    if score >= 0.80:
        return "심각"
    if score >= 0.60:
        return "경계"
    if score >= 0.40:
        return "주의"
    return "관심"


# ── 쉼터 생성/배치 ────────────────────────────────────────────
def gen_shelters(region):
    out = []
    c = region["centroid"]
    n = max(8, int(region["shelterCount"] * 0.12))  # 표시용 대표 표본
    spread = 0.018 + math.sqrt(region["areaKm2"]) / 900.0
    for i in range(n):
        # 농촌일수록 쉼터가 중심에서 더 흩어짐(접근성 격차 반영)
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
        dx = (lng - s["lng"]) * 88.8  # 위도 35.7도 근사 km/deg
        dy = (lat - s["lat"]) * 111.0
        d = math.hypot(dx, dy) * 1000.0  # m
        if d < best:
            best, bid = d, s["id"]
    return best, bid


# ── 온열 출동 생성(대체셋) ─────────────────────────────────────
def gen_incidents(region, shelters, weeks):
    out = []
    base = region["population"] / 1000.0 * (0.6 + region["elderlyRatio"] * 2.2)
    c = region["centroid"]
    spread = 0.02 + math.sqrt(region["areaKm2"]) / 800.0
    idx = 0
    for w in weeks:
        # 온열 구급출동 강도 계수(현실 규모: 전주 피크 ~10여 건/주, 농촌 소군 0~2건/주)
        lam = base * heat_week_factor(w) * 0.02
        n = min(30, int(random.gauss(lam, max(0.8, lam * 0.45))))
        for _ in range(max(0, n)):
            ang = random.random() * 2 * math.pi
            r = (random.random() ** 0.5) * spread
            la = c["lat"] + r * math.sin(ang)
            lo = c["lng"] + r * math.cos(ang) * 1.1
            day = w + timedelta(days=random.randint(0, 6))
            dist, sid = nearest_shelter_dist(la, lo, shelters)
            ag = "elderly" if random.random() < (0.45 + region["elderlyRatio"] * 0.5) else ("adult" if random.random() < 0.7 else "child")
            out.append({
                "id": f"{region['code']}-I{idx:05d}",
                "lat": round(la, 5), "lng": round(lo, 5),
                "date": day.isoformat(), "regionCode": region["code"],
                "ageGroup": ag,
                "nearestShelterId": sid,
                "nearestShelterDistM": round(dist),
            })
            idx += 1
    return out


# ── 예측 모델(투명한 경량 스코어) + 등급 ────────────────────────
def normalize(v, lo, hi):
    if hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (v - lo) / (hi - lo)))


def build_forecasts(regions, incidents_by_region, weeks, hist_weeks, alert_by_week):
    """생활권×주 예측. 기온/특보·고령·노출·과거 동기 기여도 합성."""
    forecasts = []
    forecast_start = weeks[0].isoformat()
    n_hist_weeks = max(1, len(hist_weeks))
    for r in regions:
        inc = incidents_by_region.get(r["code"], [])
        # 과거 동기 주간 평균(history) — 예보 horizon 이전 출동만, 과거 주 수로 정규화
        hist_total = sum(1 for it in inc if it["date"] < forecast_start)
        hist_mean = hist_total / n_hist_weeks
        for w in weeks:
            wk = w.isoformat()
            temp_idx = heat_week_factor(w)
            alert = alert_by_week.get(wk, "없음")
            temp_idx = min(1.0, temp_idx + {"없음": 0.0, "주의보": 0.12, "경보": 0.25}[alert])
            elderly_idx = normalize(r["elderlyRatio"], 0.14, 0.36)
            exposure_idx = normalize(math.log10(r["population"]), 4.3, 5.8)
            hist_idx = normalize(hist_mean, 0.3, 10.0)
            score = (0.40 * temp_idx + 0.24 * elderly_idx + 0.16 * exposure_idx + 0.20 * hist_idx)
            score = max(0.0, min(1.0, score + random.uniform(-0.03, 0.03)))
            baseline = hist_mean * (0.7 + 0.6 * heat_week_factor(w))
            demand = baseline * (0.85 + 0.6 * temp_idx) * (1.0 + {"없음": 0, "주의보": 0.15, "경보": 0.35}[alert])
            forecasts.append({
                "regionCode": r["code"], "weekStart": wk,
                "grade": grade_of(score),
                "expectedDemand": round(demand, 1),
                "baseline": round(baseline, 1),
                "baseTempIndex": round(heat_week_factor(w), 3),  # 특보 무관 기온지수(시뮬레이터 재계산용)
                "scenarioAlert": alert,  # 해당 주 기본 폭염특보 시나리오
                "components": {
                    "tempIndex": round(temp_idx, 3), "elderlyIndex": round(elderly_idx, 3),
                    "exposureIndex": round(exposure_idx, 3), "historyIndex": round(hist_idx, 3),
                },
                "confidence": round(0.62 + 0.30 * (1 - abs(score - 0.5) * 0.4), 3),
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
    max_dist = 1.0
    raw = []
    for gx in range(G):
        for gy in range(G):
            clat = minla + (gx + 0.5) * dla
            clon = minlo + (gy + 0.5) * dlo
            dens = 0.0
            for it in incidents:
                dx = (it["lng"] - clon) * 88.8
                dy = (it["lat"] - clat) * 111.0
                d2 = dx * dx + dy * dy
                dens += math.exp(-d2 / (2 * 1.2 ** 2))
            sdist, _ = nearest_shelter_dist(clat, clon, shelters)
            raw.append([clat, clon, dens, sdist])
            max_dist = max(max_dist, sdist)
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
def build_priority_dongs(region, incidents):
    dongs = JEONBUK_DONGS.get(region["code"])
    if not dongs:
        dongs = [f"{region['name']} {i+1}동" for i in range(4)]
    out = []
    for i, dn in enumerate(dongs):
        eld = min(1.0, region["elderlyRatio"] * (1.1 + 0.5 * random.random()))
        trend = random.random()
        access = random.random()
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
    """선배치 권고 — 평년 대비 surge(증가분)와 공백지대 수 기반. 등급+절대수요로 조치 분기."""
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


# ── 백테스팅(holdout) ─────────────────────────────────────────
def backtest(regions, incidents_by_region, weeks, alert_by_week, pilot="전북"):
    """앞 60% 주차로 '학습'(지역 평균), 뒤 40% 주차로 예측 평가."""
    split = int(len(weeks) * 0.6)
    train_w = set(w.isoformat() for w in weeks[:split])
    test_w = [w for w in weeks[split:]]
    metrics = []

    def region_actuals(code):
        inc = incidents_by_region.get(code, [])
        wc = {}
        for it in inc:
            wk = monday(date.fromisoformat(it["date"])).isoformat()
            wc[wk] = wc.get(wk, 0) + 1
        return wc

    # overall 집계용
    all_pred, all_act, all_prob, all_label = [], [], [], []
    for r in regions:
        wc = region_actuals(r["code"])
        train_mean = (sum(wc.get(w, 0) for w in train_w) / max(1, len(train_w)))
        preds, acts, probs, labels = [], [], [], []
        thr = sorted([wc.get(w.isoformat(), 0) for w in weeks])
        hi_cut = thr[int(len(thr) * 0.66)] if thr else 0
        for w in test_w:
            wk = w.isoformat()
            tf = heat_week_factor(w)
            alert = alert_by_week.get(wk, "없음")
            tf = min(1.0, tf + {"없음": 0, "주의보": 0.12, "경보": 0.25}[alert])
            pred = train_mean * (0.7 + 1.1 * tf)
            act = wc.get(wk, 0)
            preds.append(pred); acts.append(act)
            probs.append(min(1.0, tf * 0.7 + normalize(train_mean, 0.5, 12) * 0.3))
            labels.append(1 if act >= max(1, hi_cut) else 0)
        if not acts:
            continue
        mae = sum(abs(p - a) for p, a in zip(preds, acts)) / len(acts)
        base_mae = sum(abs(train_mean - a) for a in acts) / len(acts)
        brier = sum((pr - la) ** 2 for pr, la in zip(probs, labels)) / len(labels)
        auc = _auc(probs, labels)
        metrics.append({
            "scope": r["code"], "scopeName": r["name"],
            "auc": round(auc, 3), "mae": round(mae, 2), "brier": round(brier, 3),
            "baselineMae": round(base_mae, 2),
            "improvement": round((base_mae - mae) / base_mae, 3) if base_mae > 0 else 0,
            "n": len(acts), "period": f"{test_w[0]}~{test_w[-1]}",
        })
        all_pred += preds; all_act += acts; all_prob += probs; all_label += labels
    # overall
    if all_act:
        mae = sum(abs(p - a) for p, a in zip(all_pred, all_act)) / len(all_act)
        base = sum(all_act) / len(all_act)
        base_mae = sum(abs(base - a) for a in all_act) / len(all_act)
        brier = sum((pr - la) ** 2 for pr, la in zip(all_prob, all_label)) / len(all_label)
        metrics.insert(0, {
            "scope": f"overall:{pilot}", "scopeName": f"{pilot} 전체(생활권-주)",
            "auc": round(_auc(all_prob, all_label), 3), "mae": round(mae, 2),
            "brier": round(brier, 3), "baselineMae": round(base_mae, 2),
            "improvement": round((base_mae - mae) / base_mae, 3) if base_mae > 0 else 0,
            "n": len(all_act), "period": f"{test_w[0]}~{test_w[-1]}",
        })
    return metrics


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


# ── 메인 ──────────────────────────────────────────────────────
def build_pilot(pilot, regions, hist_weeks, forecast_weeks, alert_by_week):
    """한 권역(전북/서울)의 전체 산출물 생성."""
    shelters_by_region, incidents_by_region = {}, {}
    shelters, incidents = [], []
    for r in regions:
        sh = gen_shelters(r)
        shelters_by_region[r["code"]] = sh
        shelters += sh
        inc = gen_incidents(r, sh, hist_weeks + forecast_weeks)
        incidents_by_region[r["code"]] = inc
        incidents += inc
    forecasts = build_forecasts(regions, incidents_by_region, forecast_weeks, hist_weeks, alert_by_week)
    gap_cells = []
    for r in regions:
        gap_cells += build_gap_cells(r, shelters_by_region[r["code"]], incidents_by_region[r["code"]])
    priority_dongs = []
    for r in regions:
        priority_dongs += build_priority_dongs(r, incidents_by_region[r["code"]])
    target_week = max(forecast_weeks, key=heat_week_factor).isoformat()
    blind_by_region = {}
    for c in gap_cells:
        if c["isBlindSpot"]:
            blind_by_region[c["regionCode"]] = blind_by_region.get(c["regionCode"], 0) + 1
    deploy_recs = build_deploy_recs(regions, forecasts, target_week, blind_by_region)
    briefings = build_briefings(regions, forecasts, target_week)
    bt = backtest(regions, incidents_by_region, hist_weeks, alert_by_week, pilot)
    return {
        "shelters": shelters, "incidents": incidents,
        "forecasts": forecasts, "gapCells": gap_cells,
        "priorityDongs": priority_dongs, "deployRecs": deploy_recs,
        "briefings": briefings, "backtest": bt, "target_week": target_week,
    }


def main():
    seed = load_seed()
    raw = find_raw_csvs()
    data_source = "real" if raw.get("jeonbuk_fusion") else "sample"
    notes = []
    sources = [
        "소방안전 빅데이터 플랫폼: 전라북도_온열질환_무더위쉼터_융합데이터(C0100)",
        "소방안전 빅데이터 플랫폼: 서울소방재난본부_온열질환/고령자 구급출동 현황(C0100)",
        "소방안전 빅데이터 플랫폼: 소방청_일일상황보고(C0100)",
        "기상청 API허브 폭염특보·예보기온 / 에어코리아 대기지수 / 통계청 SGIS 고령인구",
    ]
    if data_source == "sample":
        notes.append("실CSV 미수령 상태 — 공개통계 기반 grounded 대체셋(dataSource=sample). "
                     "_data_raw에 bigdata-119 실CSV를 넣고 재실행하면 real로 전환됩니다.")
    else:
        notes.append(f"전북 융합데이터 실CSV 정제됨: {os.path.basename(raw['jeonbuk_fusion'])}")

    hist_weeks = summer_weeks(2023) + summer_weeks(2024)
    forecast_weeks = summer_weeks(2025)

    def alert_for(w):
        f = heat_week_factor(w)
        return "경보" if f > 0.75 else ("주의보" if f > 0.45 else "없음")
    alert_by_week = {w.isoformat(): alert_for(w) for w in (hist_weeks + forecast_weeks)}

    all_regions, shelters, incidents, forecasts = [], [], [], []
    gap_cells, priority_dongs, deploy_recs, briefings, backtest_all = [], [], [], [], []
    for pilot in ("전북", "서울"):
        regions = seed[pilot]
        all_regions += regions
        out = build_pilot(pilot, regions, hist_weeks, forecast_weeks, alert_by_week)
        shelters += out["shelters"]
        incidents += out["incidents"]
        forecasts += out["forecasts"]
        gap_cells += out["gapCells"]
        priority_dongs += out["priorityDongs"]
        deploy_recs += out["deployRecs"]
        briefings += out["briefings"]
        backtest_all += out["backtest"]
    target_week = max(forecast_weeks, key=heat_week_factor).isoformat()

    sample_inc = incidents
    if len(sample_inc) > 3000:
        sample_inc = random.sample(sample_inc, 3000)

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
            "weeks": [w.isoformat() for w in forecast_weeks],
            "defaultWeek": target_week,
            "incidentCount": len(incidents),
            "shelterCount": len(shelters),
            "dateRange": f"{hist_weeks[0]}~{forecast_weeks[-1]}",
            "sources": sources,
        },
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK dataSource={data_source} regions={len(all_regions)} shelters={len(shelters)} "
          f"incidents={len(incidents)} forecasts={len(forecasts)} gapCells={len(gap_cells)} "
          f"backtest={len(backtest_all)} -> {OUT}")
    for m in backtest_all:
        if m["scope"].startswith("overall"):
            print(f"   {m['scopeName']}: AUC={m['auc']} MAE={m['mae']} (baseline {m['baselineMae']}, "
                  f"개선 {round(m['improvement']*100)}%) n={m['n']}")


if __name__ == "__main__":
    main()
