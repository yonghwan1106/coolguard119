"use client";
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Popup as MapLibrePopup, GeoJSONSource } from "maplibre-gl";
import type { Region, Shelter, GapCell, HeatIncident } from "@/lib/types";
import type { AdjustedForecast } from "@/lib/clientEngine";
import { RISK_COLORS } from "@/lib/types";

export interface MapConsoleProps {
  pilot: "전북" | "서울";
  regions: Region[];
  adjusted: AdjustedForecast[];
  shelters: Shelter[];
  gapCells: GapCell[];
  incidents: HeatIncident[];
  selectedRegion: string | null;
  onSelectRegion: (code: string | null) => void;
  layers: { gap: boolean; shelters: boolean; incidents: boolean };
}

const CENTER: Record<"전북" | "서울", { c: [number, number]; z: number }> = {
  전북: { c: [127.1, 35.72], z: 8.2 },
  서울: { c: [126.99, 37.55], z: 10.2 },
};

// 공백지대 색상(저→고): 청록 → 황 → 적
function gapColor(score: number): string {
  if (score >= 0.7) return "#d4453a";
  if (score >= 0.55) return "#e87a3a";
  if (score >= 0.4) return "#e8b23a";
  return "#3a7bd5";
}

function regionFC(regions: Region[], adjusted: AdjustedForecast[], selected: string | null) {
  const byCode = new Map(adjusted.map((a) => [a.regionCode, a]));
  return {
    type: "FeatureCollection" as const,
    features: regions.map((r) => {
      const a = byCode.get(r.code);
      const grade = a?.grade ?? "관심";
      const demand = a?.expectedDemand ?? 0;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [r.centroid.lng, r.centroid.lat] },
        properties: {
          code: r.code,
          name: r.name,
          grade,
          demand,
          color: RISK_COLORS[grade],
          radius: 13 + Math.min(34, demand * 2.4),
          selected: r.code === selected ? 1 : 0,
          label: `${r.name} ${demand.toFixed(1)}건`,
        },
      };
    }),
  };
}

function gapFC(cells: GapCell[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((c) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
      properties: {
        color: gapColor(c.gapScore),
        score: c.gapScore,
        blind: c.isBlindSpot ? 1 : 0,
        radius: 8 + c.gapScore * 26,
        dist: c.nearestShelterDistM,
      },
    })),
  };
}

function pointFC(items: { lat: number; lng: number }[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {},
    })),
  };
}

export default function MapConsole(props: MapConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 최초 1회: 지도 초기화
  useEffect(() => {
    let cancelled = false;
    let popup: MapLibrePopup | null = null;
    (async () => {
      const maplibreModule = await import("maplibre-gl");
      const maplibre = maplibreModule.default;
      if (cancelled || !containerRef.current) return;
      const { c, z } = CENTER[propsRef.current.pilot];
      const map = new maplibre.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            carto: {
              type: "raster",
              tiles: [
                "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
                "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
                "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              attribution: "© OpenStreetMap © CARTO",
            },
          },
          layers: [{ id: "carto", type: "raster", source: "carto" }],
        },
        center: c,
        zoom: z,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

      map.on("load", () => {
        // 소스
        map.addSource("gap", { type: "geojson", data: gapFC([]) });
        map.addSource("incidents", { type: "geojson", data: pointFC([]) });
        map.addSource("shelters", { type: "geojson", data: pointFC([]) });
        map.addSource("regions", { type: "geojson", data: regionFC([], [], null) });

        // 1) 출동 히트맵(최하단)
        map.addLayer({
          id: "incidents-heat",
          type: "heatmap",
          source: "incidents",
          paint: {
            "heatmap-radius": 18,
            "heatmap-intensity": 0.7,
            "heatmap-opacity": 0.55,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,0,0,0)", 0.3, "#3a7bd5", 0.6, "#e8b23a", 1, "#d4453a",
            ],
          },
        });

        // 2) 공백지대 격자
        map.addLayer({
          id: "gap-cells",
          type: "circle",
          source: "gap",
          paint: {
            "circle-radius": ["*", ["get", "radius"], 0.82],
            "circle-color": ["get", "color"],
            // 공백지대(blind)만 진하게, 일반 격자는 옅게 — 등급 원 가독성 확보
            "circle-opacity": ["case", ["==", ["get", "blind"], 1], 0.34, 0.12],
            "circle-stroke-width": ["case", ["==", ["get", "blind"], 1], 1.6, 0],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.75,
            "circle-blur": 0.35,
          },
        });

        // 3) 쉼터
        map.addLayer({
          id: "shelters-pt",
          type: "circle",
          source: "shelters",
          paint: {
            "circle-radius": 3.4,
            "circle-color": "#7fc7ff",
            "circle-stroke-width": 0.6,
            "circle-stroke-color": "#0b1220",
            "circle-opacity": 0.85,
          },
        });

        // 4) 생활권 등급(상단) — 외곽 선택 강조
        map.addLayer({
          id: "regions-glow",
          type: "circle",
          source: "regions",
          paint: {
            "circle-radius": ["+", ["get", "radius"], 6],
            "circle-color": ["get", "color"],
            "circle-opacity": ["case", ["==", ["get", "selected"], 1], 0.25, 0],
          },
        });
        map.addLayer({
          id: "regions-pt",
          type: "circle",
          source: "regions",
          paint: {
            "circle-radius": ["get", "radius"],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.82,
            "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 1.2],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "regions-label",
          type: "symbol",
          source: "regions",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 0.1],
            "text-anchor": "center",
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff", "text-halo-color": "#0b1220", "text-halo-width": 1.2 },
        });

        readyRef.current = true;
        syncAll();

        // 인터랙션
        map.on("click", "regions-pt", (e) => {
          const f = e.features?.[0];
          if (f) propsRef.current.onSelectRegion(String(f.properties?.code));
        });
        map.on("click", (e) => {
          const hits = map.queryRenderedFeatures(e.point, { layers: ["regions-pt"] });
          if (!hits.length) propsRef.current.onSelectRegion(null);
        });
        for (const lyr of ["regions-pt", "gap-cells"]) {
          map.on("mouseenter", lyr, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", lyr, () => {
            map.getCanvas().style.cursor = "";
            popup?.remove();
          });
        }
        map.on("mousemove", "regions-pt", (e) => {
          const f = e.features?.[0];
          if (!f || !popup) return;
          const p = f.properties!;
          popup
            .setLngLat(e.lngLat)
            .setHTML(`<b>${p.name}</b><br/>등급 <b style="color:${p.color}">${p.grade}</b> · 예측 ${Number(p.demand).toFixed(1)}건/주`)
            .addTo(map);
        });
        map.on("mousemove", "gap-cells", (e) => {
          const f = e.features?.[0];
          if (!f || !popup) return;
          const p = f.properties!;
          // 쉼터는 합성 표본이라 미터 정밀도 대신 ~100m 반올림 + (추정) 병기
          const approx = Math.round(Number(p.dist) / 100) * 100;
          popup
            .setLngLat(e.lngLat)
            .setHTML(
              `공백지수 <b>${Number(p.score).toFixed(2)}</b><br/>최근접쉼터 약 ${approx}m <span style="opacity:.7">(추정·합성 표본)</span>${
                p.blind ? " · <b style='color:#ff9b93'>공백지대</b>" : ""
              }`
            )
            .addTo(map);
        });
      });
    })();

    return () => {
      cancelled = true;
      popup?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 데이터/레이어 변경 동기화
  function syncAll() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const p = propsRef.current;
    (map.getSource("regions") as GeoJSONSource | undefined)?.setData(
      regionFC(p.regions, p.adjusted, p.selectedRegion) as never
    );
    (map.getSource("gap") as GeoJSONSource | undefined)?.setData(gapFC(p.layers.gap ? p.gapCells : []) as never);
    (map.getSource("shelters") as GeoJSONSource | undefined)?.setData(
      pointFC(p.layers.shelters ? p.shelters : []) as never
    );
    (map.getSource("incidents") as GeoJSONSource | undefined)?.setData(
      pointFC(p.layers.incidents ? p.incidents : []) as never
    );
    if (map.getLayer("shelters-pt")) map.setLayoutProperty("shelters-pt", "visibility", p.layers.shelters ? "visible" : "none");
    if (map.getLayer("incidents-heat"))
      map.setLayoutProperty("incidents-heat", "visibility", p.layers.incidents ? "visible" : "none");
    if (map.getLayer("gap-cells")) map.setLayoutProperty("gap-cells", "visibility", p.layers.gap ? "visible" : "none");
  }

  useEffect(() => {
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.adjusted, props.gapCells, props.shelters, props.incidents, props.selectedRegion, props.layers]);

  // pilot 변경 시 리센터
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { c, z } = CENTER[props.pilot];
    map.flyTo({ center: c, zoom: z, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pilot]);

  // 인라인 스타일로 위치 고정 — MapLibre가 주입하는 .maplibregl-map{position:relative}가
  // Tailwind .absolute 를 덮어써 높이가 0이 되는 문제를 방지(인라인 > 클래스 특이도)
  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
