import { useEffect, useRef } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import OSM from 'ol/source/OSM'
import TileWMS from 'ol/source/TileWMS'
import Feature from 'ol/Feature'
import Draw from 'ol/interaction/Draw'
import { Fill, Stroke, Style } from 'ol/style'
import { fromLonLat, toLonLat } from 'ol/proj'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import type Polygon from 'ol/geom/Polygon'
import 'ol/ol.css'
import { CADASTRAL_WMS, wmtsUrl, type BaseMap } from '../lib/vworld'
import { parcelGeometry, type Parcel } from '../lib/parcel'

export interface FlyTarget {
  lon: number
  lat: number
  zoom?: number
  seq: number
}

interface Props {
  vworldKey: string
  baseMap: BaseMap
  showCadastral: boolean
  parcel: Parcel | null
  flyTo: FlyTarget | null
  drawing: boolean
  onMapClick: (lon: number, lat: number) => void
  onDrawEnd: (ring: number[][]) => void
}

const SEOUL = fromLonLat([126.978, 37.5665])

const parcelStyle = new Style({
  stroke: new Stroke({ color: '#e8590c', width: 3 }),
  fill: new Fill({ color: 'rgba(232, 89, 12, 0.12)' }),
})

export default function MapView(props: Props) {
  const { vworldKey, baseMap, showCadastral, parcel, flyTo, drawing, onMapClick, onDrawEnd } = props
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const baseLayer = useRef(new TileLayer({ zIndex: 0 }))
  const labelLayer = useRef(new TileLayer({ zIndex: 1 }))
  const cadastralLayer = useRef(new TileLayer({ zIndex: 2, opacity: 0.9 }))
  const parcelSource = useRef(new VectorSource())
  // OL handlers are bound once; read the latest callbacks through refs.
  const clickCb = useRef(onMapClick)
  const drawCb = useRef(onDrawEnd)
  const drawingRef = useRef(drawing)
  clickCb.current = onMapClick
  drawCb.current = onDrawEnd
  drawingRef.current = drawing

  useEffect(() => {
    const map = new OlMap({
      target: el.current!,
      layers: [
        baseLayer.current,
        labelLayer.current,
        cadastralLayer.current,
        new VectorLayer({ source: parcelSource.current, style: parcelStyle, zIndex: 10 }),
      ],
      view: new View({ center: SEOUL, zoom: 12, maxZoom: 21 }),
      controls: defaultControls().extend([new ScaleLine()]),
    })
    map.on('singleclick', (e) => {
      if (drawingRef.current) return
      const [lon, lat] = toLonLat(e.coordinate)
      clickCb.current(lon, lat)
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
          params: { ...CADASTRAL_WMS.params, KEY: vworldKey, DOMAIN: window.location.hostname },
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
    mapRef.current?.getView().fit(geom.getExtent(), { padding: [80, 80, 80, 80], maxZoom: 19, duration: 400 })
  }, [parcel])

  useEffect(() => {
    if (!flyTo) return
    mapRef.current?.getView().animate({ center: fromLonLat([flyTo.lon, flyTo.lat]), zoom: flyTo.zoom ?? 18, duration: 500 })
  }, [flyTo])

  // 키가 없거나 지적도에 없는 땅은 직접 그려서 필지로 쓴다.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing) return
    const draw = new Draw({ source: new VectorSource(), type: 'Polygon', style: parcelStyle })
    draw.on('drawend', (e) => {
      const ring = (e.feature.getGeometry() as Polygon).getCoordinates()[0].map((c) => toLonLat(c))
      drawCb.current(ring)
    })
    map.addInteraction(draw)
    return () => {
      map.removeInteraction(draw)
    }
  }, [drawing])

  return <div ref={el} className="map" />
}
