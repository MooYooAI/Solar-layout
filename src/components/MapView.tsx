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
import { Fill, Stroke, Style } from 'ol/style'
import { fromLonLat, toLonLat } from 'ol/proj'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import MultiPolygon from 'ol/geom/MultiPolygon'
import type Polygon from 'ol/geom/Polygon'
import type { FeatureLike } from 'ol/Feature'
import 'ol/ol.css'
import { CADASTRAL_WMS, wmtsUrl, type BaseMap } from '../lib/vworld'
import { parcelGeometry, type Parcel } from '../lib/parcel'
import { moduleQuadsLonLat, type LayoutParams, type ModuleSet, type SetGeometry } from '../lib/layout'

export interface FlyTarget {
  lon: number
  lat: number
  zoom?: number
  seq: number
}

/** draw: 필지 직접 그리기, select: 세트 선택·이동, add: 클릭한 자리에 세트 추가 */
export type MapTool = 'none' | 'draw' | 'select' | 'add'

interface Props {
  vworldKey: string
  baseMap: BaseMap
  showCadastral: boolean
  parcel: Parcel | null
  flyTo: FlyTarget | null
  tool: MapTool
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  selected: ReadonlySet<string>
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
const setSelectedStyle = new Style({
  stroke: new Stroke({ color: '#ffd43b', width: 2 }),
  fill: new Fill({ color: 'rgba(25, 113, 194, 0.95)' }),
})

export default function MapView(props: Props) {
  const { vworldKey, baseMap, showCadastral, parcel, flyTo, tool, sets, params, geometry, selected } = props
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const baseLayer = useRef(new TileLayer({ zIndex: 0 }))
  const labelLayer = useRef(new TileLayer({ zIndex: 1 }))
  const cadastralLayer = useRef(new TileLayer({ zIndex: 2, opacity: 0.9 }))
  const parcelSource = useRef(new VectorSource())
  const setSource = useRef(new VectorSource())
  const selectedFeatures = useRef(new Collection<Feature>())
  // OL handlers are bound once; read the latest props through a ref.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const setLayer = new VectorLayer({
      source: setSource.current,
      zIndex: 11,
      style: (f: FeatureLike) => (latest.current.selected.has(f.getId() as string) ? setSelectedStyle : setStyle),
    })
    const map = new OlMap({
      target: el.current!,
      layers: [
        baseLayer.current,
        labelLayer.current,
        cadastralLayer.current,
        new VectorLayer({ source: parcelSource.current, style: parcelStyle, zIndex: 10 }),
        setLayer,
      ],
      view: new View({ center: SEOUL, zoom: 12, maxZoom: 22 }),
      controls: defaultControls().extend([new ScaleLine()]),
    })
    map.on('singleclick', (e) => {
      const p = latest.current
      const [lon, lat] = toLonLat(e.coordinate)
      if (p.tool === 'draw') return
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
    if (!flyTo) return
    mapRef.current?.getView().animate({ center: fromLonLat([flyTo.lon, flyTo.lat]), zoom: flyTo.zoom ?? 18, duration: 500 })
  }, [flyTo])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tool === 'draw') {
      // 키가 없거나 지적도에 없는 땅은 직접 그려서 필지로 쓴다.
      const draw = new Draw({ source: new VectorSource(), type: 'Polygon', style: parcelStyle })
      draw.on('drawend', (e) => {
        const ring = (e.feature.getGeometry() as Polygon).getCoordinates()[0].map((c) => toLonLat(c))
        latest.current.onDrawEnd(ring)
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
