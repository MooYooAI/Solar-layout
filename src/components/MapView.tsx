import { useEffect, useRef } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import Collection from 'ol/Collection'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import OSM from 'ol/source/OSM'
import TileWMS from 'ol/source/TileWMS'
import Feature from 'ol/Feature'
import Draw from 'ol/interaction/Draw'
import Translate from 'ol/interaction/Translate'
import DragBox from 'ol/interaction/DragBox'
import { shiftKeyOnly } from 'ol/events/condition'
import { getCenter } from 'ol/extent'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import { getArea, getLength } from 'ol/sphere'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import { fromLonLat, toLonLat } from 'ol/proj'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import MultiPolygon from 'ol/geom/MultiPolygon'
import Polygon from 'ol/geom/Polygon'
import type { FeatureLike } from 'ol/Feature'
import 'ol/ol.css'
import { CADASTRAL_WMS, ZONING_WMS, wmtsUrl, type BaseMap } from '../lib/vworld'
import { parcelGeometry, type Parcel } from '../lib/parcel'
import { moduleQuadsLonLat, type LayoutParams, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Obstacle } from '../lib/shading'
import type { TerrainCell } from '../lib/terrain'
import { CUTFILL_COLORS, SLOPE_COLORS, cutFillClass, slopeClass } from '../lib/terrainColors'

export interface FlyTarget {
  lon: number
  lat: number
  zoom?: number
  seq: number
}

/**
 * draw: 필지 직접 그리기, select: 세트 선택·이동, add: 클릭한 자리에 세트 추가, obstacle: 장애물 그리기,
 * measureLine / measureArea: 거리·면적 재기, rect: 클릭한 자리에 수치로 정한 사각형 영역 놓기
 */
export type MapTool = 'none' | 'draw' | 'select' | 'add' | 'obstacle' | 'measureLine' | 'measureArea' | 'rect'

interface Props {
  vworldKey: string
  baseMap: BaseMap
  showCadastral: boolean
  showZoning: boolean
  /** 값이 바뀌면 측정 결과를 지운다 */
  clearMeasuresSeq: number
  parcel: Parcel | null
  flyTo: FlyTarget | null
  tool: MapTool
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  selected: ReadonlySet<string>
  obstacles: Obstacle[]
  shadows: Array<{ ring: number[][]; fromSet: boolean }>
  /** 세트별 그늘 비율. 음영 탭에서만 채운다. */
  setShade: ReadonlyMap<string, number> | null
  terrainCells: TerrainCell[] | null
  terrainView: 'slope' | 'cutfill' | 'none'
  onObstacleDrawn: (ring: number[][]) => void
  onMapClick: (lon: number, lat: number) => void
  onDrawEnd: (ring: number[][]) => void
  onSelect: (ids: string[], additive: boolean) => void
  onMoveSets: (moved: Array<{ id: string; lon: number; lat: number }>) => void
  onAddSet: (lon: number, lat: number) => void
}

const SEOUL = fromLonLat([126.978, 37.5665])

const parcelStyle = new Style({
  stroke: new Stroke({ color: '#e8590c', width: 3 }),
  fill: new Fill({ color: 'rgba(232, 89, 12, 0.10)' }),
})
const setStyle = new Style({
  stroke: new Stroke({ color: '#a5c8ff', width: 1 }),
  fill: new Fill({ color: 'rgba(28, 64, 140, 0.85)' }),
})
const shadedStyles = [0.25, 0.5, 0.75, 1].map(
  (k) =>
    new Style({
      stroke: new Stroke({ color: '#ffc9c9', width: 1 }),
      fill: new Fill({ color: `rgba(${Math.round(28 + (224 - 28) * k)}, ${Math.round(64 - 30 * k)}, ${Math.round(140 - 100 * k)}, 0.9)` }),
    }),
)
const obstacleStyle = new Style({
  stroke: new Stroke({ color: '#495057', width: 2 }),
  fill: new Fill({ color: 'rgba(134, 142, 150, 0.6)' }),
})
const shadowStyle = new Style({ fill: new Fill({ color: 'rgba(20, 20, 30, 0.35)' }) })
const setShadowStyle = new Style({ fill: new Fill({ color: 'rgba(20, 20, 30, 0.22)' }) })
const setSelectedStyle = new Style({
  stroke: new Stroke({ color: '#ffd43b', width: 2 }),
  fill: new Fill({ color: 'rgba(25, 113, 194, 0.95)' }),
})

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`)
const fmtArea = (a: number) =>
  a >= 1e6 ? `${(a / 1e6).toFixed(3)} ㎢` : `${Math.round(a).toLocaleString('ko-KR')} ㎡ (${Math.round(a / 3.305785).toLocaleString('ko-KR')} 평)`

/** 측정 도형: 선은 총 길이, 면은 면적과 둘레를 가운데에 적는다. 그리는 중에도 같은 스타일을 쓴다. */
function measureStyle(f: FeatureLike): Style[] {
  const g = f.getGeometry()
  const base = new Style({
    stroke: new Stroke({ color: '#fab005', width: 2.5, lineDash: [6, 4] }),
    fill: new Fill({ color: 'rgba(250, 176, 5, 0.15)' }),
    image: new CircleStyle({ radius: 4, fill: new Fill({ color: '#fab005' }) }),
  })
  let label = ''
  let at: Point | undefined
  if (g instanceof LineString) {
    label = fmtLen(getLength(g))
    at = new Point(g.getLastCoordinate())
  } else if (g instanceof Polygon && getArea(g) > 0) {
    label = `${fmtArea(getArea(g))}\n둘레 ${fmtLen(getLength(new LineString(g.getCoordinates()[0])))}`
    at = g.getInteriorPoint()
  }
  if (!label || !at) return [base]
  return [
    base,
    new Style({
      geometry: at,
      text: new Text({
        text: label,
        font: '600 12px Pretendard, sans-serif',
        fill: new Fill({ color: '#1d2330' }),
        backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.9)' }),
        padding: [3, 5, 3, 5],
        offsetY: -14,
      }),
    }),
  ]
}

const slopeStyles = SLOPE_COLORS.map((c) => new Style({ fill: new Fill({ color: c }), stroke: new Stroke({ color: c, width: 1 }) }))
const cutFillStyles = CUTFILL_COLORS.map((c) => new Style({ fill: new Fill({ color: c }), stroke: new Stroke({ color: c, width: 1 }) }))

export default function MapView(props: Props) {
  const { vworldKey, baseMap, showCadastral, showZoning, clearMeasuresSeq, parcel, flyTo, tool, sets, params, geometry, selected, obstacles, shadows, setShade, terrainCells, terrainView } = props
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const baseLayer = useRef(new TileLayer({ zIndex: 0 }))
  const labelLayer = useRef(new TileLayer({ zIndex: 1 }))
  const zoningLayer = useRef(new TileLayer({ zIndex: 1.5, opacity: 0.55 }))
  const cadastralLayer = useRef(new TileLayer({ zIndex: 2, opacity: 0.9 }))
  const measureSource = useRef(new VectorSource())
  const parcelSource = useRef(new VectorSource())
  const setSource = useRef(new VectorSource())
  const obstacleSource = useRef(new VectorSource())
  const shadowSource = useRef(new VectorSource())
  const terrainSource = useRef(new VectorSource())
  const selectedFeatures = useRef(new Collection<Feature>())
  // OL handlers are bound once; read the latest props through a ref.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const setLayer = new VectorLayer({
      source: setSource.current,
      zIndex: 11,
      style: (f: FeatureLike) => {
        const id = f.getId() as string
        if (latest.current.selected.has(id)) return setSelectedStyle
        const shade = latest.current.setShade?.get(id) ?? 0
        return shade > 0 ? shadedStyles[Math.min(3, Math.floor(shade * 4))] : setStyle
      },
    })
    const map = new OlMap({
      target: el.current!,
      layers: [
        baseLayer.current,
        labelLayer.current,
        zoningLayer.current,
        cadastralLayer.current,
        new VectorLayer({
          source: terrainSource.current,
          zIndex: 9,
          opacity: 0.7,
          style: (f: FeatureLike) =>
            latest.current.terrainView === 'cutfill'
              ? cutFillStyles[cutFillClass(f.get('dz'))]
              : slopeStyles[slopeClass(f.get('slope'))],
        }),
        new VectorLayer({ source: parcelSource.current, style: parcelStyle, zIndex: 10 }),
        new VectorLayer({
          source: shadowSource.current,
          zIndex: 10.5,
          style: (f: FeatureLike) => (f.get('fromSet') ? setShadowStyle : shadowStyle),
        }),
        setLayer,
        new VectorLayer({ source: obstacleSource.current, style: obstacleStyle, zIndex: 12 }),
        new VectorLayer({ source: measureSource.current, style: measureStyle, zIndex: 13 }),
      ],
      view: new View({ center: SEOUL, zoom: 12, maxZoom: 22 }),
      controls: defaultControls().extend([new ScaleLine()]),
    })
    map.on('singleclick', (e) => {
      const p = latest.current
      const [lon, lat] = toLonLat(e.coordinate)
      if (p.tool === 'draw' || p.tool === 'obstacle' || p.tool === 'measureLine' || p.tool === 'measureArea') return
      if (p.tool === 'add') return p.onAddSet(lon, lat)
      if (p.tool === 'select') {
        const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f, { layerFilter: (l) => l === setLayer })
        const additive = e.originalEvent.shiftKey
        if (hit) p.onSelect([hit.getId() as string], additive)
        else if (!additive) p.onSelect([], false)
        return
      }
      p.onMapClick(lon, lat)
    })
    mapRef.current = map
    return () => map.setTarget(undefined)
  }, [])

  // 배경지도: 키가 있으면 VWorld, 없으면 OSM
  useEffect(() => {
    if (vworldKey) {
      baseLayer.current.setSource(new XYZ({ url: wmtsUrl(vworldKey, baseMap), maxZoom: 19, crossOrigin: 'anonymous' }))
      labelLayer.current.setSource(
        baseMap === 'Satellite' ? new XYZ({ url: wmtsUrl(vworldKey, 'Hybrid'), maxZoom: 19, crossOrigin: 'anonymous' }) : null,
      )
    } else {
      baseLayer.current.setSource(new OSM())
      labelLayer.current.setSource(null)
    }
  }, [vworldKey, baseMap])

  useEffect(() => {
    const show = showCadastral && !!vworldKey
    cadastralLayer.current.setVisible(show)
    if (show) {
      cadastralLayer.current.setSource(
        new TileWMS({
          url: CADASTRAL_WMS.url,
          params: { ...CADASTRAL_WMS.params, KEY: vworldKey, DOMAIN: window.location.origin },
          crossOrigin: 'anonymous',
        }),
      )
    }
  }, [vworldKey, showCadastral])

  useEffect(() => {
    const show = showZoning && !!vworldKey
    zoningLayer.current.setVisible(show)
    if (show && !zoningLayer.current.getSource()) {
      zoningLayer.current.setSource(
        new TileWMS({
          url: ZONING_WMS.url,
          params: { ...ZONING_WMS.params, KEY: vworldKey, DOMAIN: window.location.origin },
          crossOrigin: 'anonymous',
        }),
      )
    }
  }, [vworldKey, showZoning])

  useEffect(() => {
    measureSource.current.clear()
  }, [clearMeasuresSeq])

  useEffect(() => {
    const src = parcelSource.current
    src.clear()
    if (!parcel) return
    const geom = parcelGeometry(parcel).transform('EPSG:4326', 'EPSG:3857')
    src.addFeature(new Feature(geom))
    mapRef.current?.getView().fit(geom.getExtent(), { padding: [80, 80, 80, 80], maxZoom: 20, duration: 400 })
  }, [parcel])

  // 세트마다 모듈 한 장씩을 멀티폴리곤으로 그린다.
  useEffect(() => {
    const src = setSource.current
    src.clear()
    src.addFeatures(
      sets.map((s) => {
        const geom = new MultiPolygon(moduleQuadsLonLat(s, params, geometry).map((q) => [q])).transform(
          'EPSG:4326',
          'EPSG:3857',
        )
        const f = new Feature(geom)
        f.setId(s.id)
        return f
      }),
    )
  }, [sets, params, geometry])

  useEffect(() => {
    const sel = selectedFeatures.current
    sel.clear()
    for (const id of selected) {
      const f = setSource.current.getFeatureById(id)
      if (f) sel.push(f as Feature)
    }
    setSource.current.changed()
  }, [selected, sets])

  useEffect(() => {
    setSource.current.changed()
  }, [setShade])

  useEffect(() => {
    const src = obstacleSource.current
    src.clear()
    src.addFeatures(obstacles.map((o) => new Feature(new Polygon([o.ring]).transform('EPSG:4326', 'EPSG:3857'))))
  }, [obstacles])

  useEffect(() => {
    const src = terrainSource.current
    src.clear()
    if (!terrainCells || terrainView === 'none') return
    src.addFeatures(
      terrainCells.map((c) => {
        const f = new Feature(new Polygon([c.ring]).transform('EPSG:4326', 'EPSG:3857'))
        f.set('dz', c.dz)
        f.set('slope', c.slopePct)
        return f
      }),
    )
  }, [terrainCells, terrainView])

  useEffect(() => {
    const src = shadowSource.current
    src.clear()
    src.addFeatures(
      shadows.map((s) => {
        const f = new Feature(new Polygon([s.ring]).transform('EPSG:4326', 'EPSG:3857'))
        f.set('fromSet', s.fromSet)
        return f
      }),
    )
  }, [shadows])

  useEffect(() => {
    if (!flyTo) return
    mapRef.current?.getView().animate({ center: fromLonLat([flyTo.lon, flyTo.lat]), zoom: flyTo.zoom ?? 18, duration: 500 })
  }, [flyTo])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tool === 'draw' || tool === 'obstacle') {
      // draw: 키가 없거나 지적도에 없는 땅은 직접 그려서 필지로 쓴다. obstacle: 건물·나무 바닥 윤곽.
      const draw = new Draw({
        source: new VectorSource(),
        type: 'Polygon',
        style: tool === 'draw' ? parcelStyle : obstacleStyle,
      })
      draw.on('drawend', (e) => {
        const ring = (e.feature.getGeometry() as Polygon).getCoordinates()[0].map((c) => toLonLat(c))
        if (tool === 'draw') latest.current.onDrawEnd(ring)
        else latest.current.onObstacleDrawn(ring)
      })
      map.addInteraction(draw)
      return () => {
        map.removeInteraction(draw)
      }
    }
    if (tool === 'measureLine' || tool === 'measureArea') {
      // 측정 결과는 지울 때까지 지도에 남긴다.
      const draw = new Draw({
        source: measureSource.current,
        type: tool === 'measureLine' ? 'LineString' : 'Polygon',
        style: measureStyle,
      })
      map.addInteraction(draw)
      return () => {
        map.removeInteraction(draw)
      }
    }
    if (tool === 'select') {
      // 선택된 세트를 끌어서 옮기고, Shift+드래그로 여러 개를 한 번에 고른다.
      const translate = new Translate({ features: selectedFeatures.current })
      translate.on('translateend', (e) => {
        latest.current.onMoveSets(
          e.features.getArray().map((f) => {
            const [lon, lat] = toLonLat(getCenter(f.getGeometry()!.getExtent()))
            return { id: f.getId() as string, lon, lat }
          }),
        )
      })
      const box = new DragBox({ condition: shiftKeyOnly })
      box.on('boxend', () => {
        const ids: string[] = []
        setSource.current.forEachFeatureIntersectingExtent(box.getGeometry().getExtent(), (f) => {
          ids.push(f.getId() as string)
        })
        latest.current.onSelect(ids, true)
      })
      map.addInteraction(translate)
      map.addInteraction(box)
      return () => {
        map.removeInteraction(translate)
        map.removeInteraction(box)
      }
    }
  }, [tool])

  return <div ref={el} className={`map tool-${tool}`} />
}
