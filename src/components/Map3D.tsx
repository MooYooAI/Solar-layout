// 3D 지도: MapLibre GL 지형(AWS Terrarium 표고) 위에 VWorld 배경·지적도를 덮고,
// 모듈은 경사각대로 기울어진 판으로 직접 그린다(WebGL 사용자 레이어).
// 그리기·측정 도구는 2D 지도에서만 쓴다. 3D에서는 필지 고르기, 세트 선택·추가, 사각형 놓기만 된다.

import { useEffect, useRef } from 'react'
import maplibregl, {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type GeoJSONSource,
  type LngLatLike,
  type Map as MlMap,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type * as GeoJSON from 'geojson'
import { CADASTRAL_WMS, ZONING_WMS, wmtsUrl, type BaseMap } from '../lib/vworld'
import type { Parcel } from '../lib/parcel'
import { moduleQuads3D, setPosts3D, setQuadLonLat, setbackRings, type LayoutParams, type ModuleSet, type SetGeometry } from '../lib/layout'
import { LocalFrame, pointInRing, type Vec } from '../lib/geo'
import type { Obstacle } from '../lib/shading'
import type { TerrainCell } from '../lib/terrain'
import type { BuildableResult } from '../lib/buildable'
import type { ElecResult } from '../lib/electrical'
import type { PanelShade } from '../lib/analysis'
import type { TerrainShadeImage } from '../lib/terrainShadow'
import { GROUP_COLORS } from '../lib/palette'
import { CUTFILL_COLORS, SLOPE_COLORS, cutFillClass, slopeClass } from '../lib/terrainColors'
import { shared } from '../lib/viewState'
import type { FlyTarget, MapTool } from './MapView'

export type CameraView = 'top' | 'front' | 'side' | 'persp' | 'fit'

/** top: 위에서, front: 남쪽에서 모듈 정면, side: 동쪽에서 본 측면, persp: 남서쪽 위에서 비스듬히. fit은 필지에 다시 맞춘다. */
const CAMERA: Record<Exclude<CameraView, 'fit'>, { pitch: number; bearing: number }> = {
  top: { pitch: 0, bearing: 0 },
  front: { pitch: 72, bearing: 0 },
  side: { pitch: 80, bearing: -90 },
  persp: { pitch: 58, bearing: -28 },
}

interface Props {
  vworldKey: string
  baseMap: BaseMap
  showCadastral: boolean
  showZoning: boolean
  parcel: Parcel | null
  flyTo: FlyTarget | null
  tool: MapTool
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  selected: ReadonlySet<string>
  obstacles: Obstacle[]
  shadows: Array<{ ring: number[][]; fromSet: boolean }>
  setShade: ReadonlyMap<string, number> | null
  /** 모듈 표면에 떨어진 그림자(칸별). 있으면 세트 전체 색 대신 그늘진 칸만 어둡게 칠한다. */
  panelShade: PanelShade | null
  terrainCells: TerrainCell[] | null
  terrainView: 'slope' | 'cutfill' | 'buildable' | 'none'
  buildable: BuildableResult | null
  elec: ElecResult | null
  /** 산·언덕이 땅에 드리운 그림자 그림. 있으면 지형 위에 덮는다. */
  terrainShade?: TerrainShadeImage | null
  /** 음영을 볼 때의 해 위치(도: 북 0 시계 방향 방위, 고도). 있으면 지형 음영을 그 해에 맞춰 칠한다. */
  sunLight?: { bearing: number; altitude: number } | null
  /** 지형 높이 과장 배율 */
  exaggeration: number
  /** 시점 바꾸기 요청. seq가 바뀔 때마다 그 시점으로 돌린다. bearing이 있으면 그 방향을 낮게 바라본다. */
  camera: { view: CameraView; seq: number; bearing?: number } | null
  onMapClick: (lon: number, lat: number) => void
  onSelect: (ids: string[], additive: boolean) => void
  onAddSet: (lon: number, lat: number) => void
  /** 다른 화면 위에 따로 띄우는 지도. 공유 시점을 쓰지 않고, 열 때 필지에 맞춘다. */
  standalone?: boolean
}

const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const demSource = { type: 'raster-dem' as const, tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: 'terrarium' as const }

type Fc = GeoJSON.FeatureCollection
const fc = (features: GeoJSON.Feature[]): Fc => ({ type: 'FeatureCollection', features })
const poly = (rings: number[][][], properties: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: rings },
})

function wmsTiles(spec: { url: string; params: Record<string, string> }, key: string): string {
  const qs = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    CRS: 'EPSG:3857',
    WIDTH: '256',
    HEIGHT: '256',
    ...spec.params,
    KEY: key,
    DOMAIN: window.location.origin,
  })
  // {bbox-epsg-3857}은 MapLibre가 채운다. URLSearchParams가 중괄호를 바꾸지 않게 뒤에 붙인다.
  return `${spec.url}?${qs}&BBOX={bbox-epsg-3857}`
}

function baseTiles(key: string, baseMap: BaseMap): { base: string[]; label: string[] | null; attribution: string } {
  if (!key)
    return {
      base: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      label: null,
      attribution: '© OpenStreetMap contributors',
    }
  return {
    base: [wmtsUrl(key, baseMap)],
    label: baseMap === 'Satellite' ? [wmtsUrl(key, 'Hybrid')] : null,
    attribution: '© VWorld',
  }
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const PANEL = hexRgb('#1c408c')
const PANEL_SELECTED = hexRgb('#1971c2')
const SELECT_EDGE = hexRgb('#ffd43b')
const POST = hexRgb('#adb5bd')
// 그늘진 모듈: 검정이 아니라 모듈 색을 어둡게(지형 그림자와 같은 톤)
const PANEL_SHADOW = hexRgb('#0e1a36')
const FRAME = hexRgb('#ced4da')
const GROUP_RGB = GROUP_COLORS.map(hexRgb)
const shadeRgb = (k: number): [number, number, number] => [
  (28 + (224 - 28) * k) / 255,
  (64 - 30 * k) / 255,
  (140 - 100 * k) / 255,
]

/** 판 색: 2D 지도와 같은 규칙(선택 > 음영 > 인버터 묶음 > 기본) */
function setColor(id: string, p: Pick<Props, 'selected' | 'setShade' | 'elec' | 'panelShade'>): [number, number, number] {
  if (p.selected.has(id)) return PANEL_SELECTED
  const shade = p.panelShade ? 0 : (p.setShade?.get(id) ?? 0)
  if (shade > 0) return shadeRgb((Math.min(3, Math.floor(shade * 4)) + 1) / 4)
  const inv = p.elec?.setInverter[id]
  return inv !== undefined ? GROUP_RGB[inv % GROUP_RGB.length] : PANEL
}

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
// 남서쪽 위에서 비추는 고정 조명. 판의 밝기 차이로 경사가 보이게 하는 용도다.
const LIGHT: V3 = (() => {
  const v: V3 = [-0.35, -0.55, 0.76]
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
})()

/** 모듈 판과 기둥을 삼각형 배열로 만든다: 위치(로컬 m, 원점 기준) xyz + 색 rgb */
function buildMesh(
  origin: LocalFrame,
  p: Props,
  ground: (s: ModuleSet) => number,
  originZ: number,
): Float32Array {
  const out: number[] = []
  const tri = (a: V3, b: V3, c: V3, col: V3, lit = true) => {
    let k = 1
    if (lit) {
      const n = crossV(sub(b, a), sub(c, a))
      const l = Math.hypot(...n) || 1
      // 양면: 아래를 보는 면도 같은 밝기로
      k = 0.55 + 0.45 * Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / l)
    }
    for (const v of [a, b, c]) out.push(v[0], v[1], v[2], col[0] * k, col[1] * k, col[2] * k)
  }
  const quad = (q: V3[], col: V3, lit = true) => {
    tri(q[0], q[1], q[2], col, lit)
    tri(q[0], q[2], q[3], col, lit)
  }
  const POST_R = 0.05
  for (const s of p.sets) {
    const [cx, cy] = origin.toLocal([s.lon, s.lat])
    const cz = ground(s) - originZ
    const at = ([x, y, z]: V3): V3 => [x + cx, y + cy, z + cz]
    const col = setColor(s.id, p)
    const sel = p.selected.has(s.id)
    // 모듈마다 테두리(프레임)를 두르고 안쪽 셀 면을 살짝 띄워 한 장씩 구분되게 한다. 선택한 세트는 노란 테두리.
    const frame = sel ? SELECT_EDGE : FRAME
    const inset = sel ? 0.86 : 0.94
    const cells = p.panelShade?.cells.get(s.id)
    const nu = p.panelShade?.nu ?? 1
    const nv = p.panelShade?.nv ?? 1
    moduleQuads3D(s, p.params, p.geometry).forEach((q, m) => {
      const w = q.map(at)
      const c: V3 = [(w[0][0] + w[2][0]) / 2, (w[0][1] + w[2][1]) / 2, (w[0][2] + w[2][2]) / 2]
      const inner = w.map((v) => [c[0] + (v[0] - c[0]) * inset, c[1] + (v[1] - c[1]) * inset, c[2] + (v[2] - c[2]) * inset + 0.01] as V3)
      quad(w, frame, !sel)
      if (!cells) {
        quad(inner, col)
        return
      }
      // 그늘 칸만 어둡게: 옆·정면에서 봐도 판 위에 진 그림자가 보인다.
      const lerp = (u: number, t: number): V3 =>
        [0, 1, 2].map((d) => (1 - u) * (1 - t) * inner[0][d] + u * (1 - t) * inner[1][d] + u * t * inner[2][d] + (1 - u) * t * inner[3][d]) as V3
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const dark = cells[(m * nv + j) * nu + i] === 1
          quad([lerp(i / nu, j / nv), lerp((i + 1) / nu, j / nv), lerp((i + 1) / nu, (j + 1) / nv), lerp(i / nu, (j + 1) / nv)], dark ? PANEL_SHADOW : col)
        }
    })
    for (const [x, y, h] of setPosts3D(s, p.params, p.geometry)) {
      const b = at([x, y, -0.3])
      const t = h + 0.3
      const c: V3[] = [
        [b[0] - POST_R, b[1] - POST_R, b[2]],
        [b[0] + POST_R, b[1] - POST_R, b[2]],
        [b[0] + POST_R, b[1] + POST_R, b[2]],
        [b[0] - POST_R, b[1] + POST_R, b[2]],
      ]
      for (let i = 0; i < 4; i++) {
        const a = c[i]
        const d = c[(i + 1) % 4]
        quad([a, d, [d[0], d[1], d[2] + t], [a[0], a[1], a[2] + t]], POST)
      }
    }
  }
  return new Float32Array(out)
}

const VS = `
uniform mat4 u_matrix;
attribute vec3 a_pos;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
}`
const FS = `
precision mediump float;
varying vec3 v_color;
void main() { gl_FragColor = vec4(v_color, 1.0); }`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  return sh
}

/** 4x4 열 우선 행렬 곱(배정밀도로 계산한 뒤 넘긴다: 지도를 크게 확대해도 떨리지 않게) */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = v
    }
  return new Float32Array(o)
}

/** 모듈 판 레이어. 원점은 첫 세트 근처에 두고 정점은 원점 기준 미터로 쓴다. */
class PanelLayer implements CustomLayerInterface {
  id = 'panels'
  type = 'custom' as const
  renderingMode = '3d' as const
  private map: MlMap | null = null
  private gl: WebGLRenderingContext | null = null
  private prog: WebGLProgram | null = null
  private buf: WebGLBuffer | null = null
  private count = 0
  private origin: LocalFrame | null = null
  private originZ = 0
  private heights = new Map<string, number>()
  private props: Props | null = null

  onAdd(map: MlMap, gl: WebGLRenderingContext) {
    this.map = map
    this.gl = gl
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    this.prog = prog
    this.buf = gl.createBuffer()
    if (this.props) this.update(this.props)
  }

  onRemove(_map: MlMap, gl: WebGLRenderingContext) {
    if (this.buf) gl.deleteBuffer(this.buf)
    if (this.prog) gl.deleteProgram(this.prog)
    this.map = null
  }

  private ground(s: ModuleSet): number {
    return this.heights.get(s.id) ?? 0
  }

  /** 지형 타일이 늦게 오면 높이가 바뀐다. 바뀐 세트가 있으면 true */
  refreshHeights(): boolean {
    const map = this.map
    const p = this.props
    if (!map || !p) return false
    let changed = false
    for (const s of p.sets) {
      const h = map.queryTerrainElevation([s.lon, s.lat]) ?? 0
      const old = this.heights.get(s.id)
      if (old === undefined || Math.abs(old - h) > 0.05) {
        this.heights.set(s.id, h)
        changed = true
      }
    }
    return changed
  }

  update(p: Props) {
    this.props = p
    const map = this.map
    if (!map) return
    this.refreshHeights()
    this.rebuild()
  }

  rebuild() {
    const map = this.map
    const p = this.props
    const gl = this.gl
    if (!map || !gl || !p || !this.buf) return
    if (!p.sets.length) {
      this.count = 0
      map.triggerRepaint()
      return
    }
    const o = p.sets[0]
    this.origin = new LocalFrame(o.lon, o.lat)
    this.originZ = this.ground(o)
    const data = buildMesh(this.origin, p, (s) => this.ground(s), this.originZ)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    this.count = data.length / 6
    map.triggerRepaint()
  }

  render(gl: WebGLRenderingContext, opts: CustomRenderMethodInput) {
    if (!this.count || !this.origin || !this.prog || !this.map) return
    // 지면 높이는 queryTerrainElevation 값이라 이미 과장 배율이 곱해져 있다.
    const m = maplibregl.MercatorCoordinate.fromLngLat([this.origin.lon0, this.origin.lat0], this.originZ)
    const s = m.meterInMercatorCoordinateUnits()
    // 로컬(동, 북, 위 m) → 메르카토르(x 동, y 남, z 위)
    const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, m.x, m.y, m.z, 1]
    gl.useProgram(this.prog)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'u_matrix'), false, mul(opts.defaultProjectionData.mainMatrix, model))
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    const aPos = gl.getAttribLocation(this.prog, 'a_pos')
    const aCol = gl.getAttribLocation(this.prog, 'a_color')
    gl.enableVertexAttribArray(aPos)
    gl.enableVertexAttribArray(aCol)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0)
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 24, 12)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLES, 0, this.count)
  }
}

const SLOPE_EXPR = ['match', ['get', 'cls'], ...SLOPE_COLORS.flatMap((c, i) => [i, c]), SLOPE_COLORS[0]]
const CUTFILL_EXPR = ['match', ['get', 'cls'], ...CUTFILL_COLORS.flatMap((c, i) => [i, c]), CUTFILL_COLORS[0]]

function initialStyle(p: Props): StyleSpecification {
  const t = baseTiles(p.vworldKey, p.baseMap)
  const empty = { type: 'geojson' as const, data: fc([]) }
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: t.base, tileSize: 256, maxzoom: 19, attribution: t.attribution },
      label: { type: 'raster', tiles: t.label ?? t.base, tileSize: 256, maxzoom: 19 },
      dem: demSource,
      hillDem: demSource,
      parcel: empty,
      terrain: empty,
      buildable: empty,
      shadows: empty,
      obstacles: empty,
      elec: empty,
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillDem',
        paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#2b2b2b' },
        layout: { visibility: p.baseMap === 'Base' || !p.vworldKey ? 'visible' : 'none' },
      },
      { id: 'label', type: 'raster', source: 'label', layout: { visibility: t.label ? 'visible' : 'none' } },
      {
        id: 'terrain-fill',
        type: 'fill',
        source: 'terrain',
        paint: { 'fill-color': ['case', ['==', ['get', 'mode'], 'cutfill'], CUTFILL_EXPR, SLOPE_EXPR] as never, 'fill-opacity': 0.7 },
      },
      {
        id: 'buildable-fill',
        type: 'fill',
        source: 'buildable',
        filter: ['!=', ['get', 'kind'], 'channel'],
        paint: {
          'fill-color': ['match', ['get', 'kind'], 'drain', 'rgba(25, 113, 194, 0.45)', 'rgba(201, 42, 42, 0.38)'],
        },
      },
      {
        id: 'buildable-channel',
        type: 'line',
        source: 'buildable',
        filter: ['==', ['get', 'kind'], 'channel'],
        paint: { 'line-color': '#1864ab', 'line-width': 2 },
      },
      { id: 'parcel-fill', type: 'fill', source: 'parcel', filter: ['!=', ['get', 'kind'], 'setback'], paint: { 'fill-color': 'rgba(232, 89, 12, 0.10)' } },
      { id: 'parcel-line', type: 'line', source: 'parcel', filter: ['!=', ['get', 'kind'], 'setback'], paint: { 'line-color': '#e8590c', 'line-width': 3 } },
      {
        id: 'parcel-setback',
        type: 'line',
        source: 'parcel',
        filter: ['==', ['get', 'kind'], 'setback'],
        paint: { 'line-color': '#ffd43b', 'line-width': 2 },
      },
      {
        id: 'shadows',
        type: 'fill',
        source: 'shadows',
        paint: { 'fill-color': ['case', ['get', 'fromSet'], 'rgba(12, 18, 38, 0.5)', 'rgba(12, 18, 38, 0.55)'] },
      },
      {
        id: 'elec-cable',
        type: 'line',
        source: 'elec',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#f08c00', 'line-width': 2, 'line-dasharray': [3, 1.5] },
      },
      {
        id: 'elec-point',
        type: 'circle',
        source: 'elec',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'kind'], 'switchboard'], 7, 5],
          'circle-color': ['case', ['==', ['get', 'kind'], 'switchboard'], '#f08c00', '#ffffff'],
          'circle-stroke-color': ['case', ['==', ['get', 'kind'], 'switchboard'], '#ffffff', '#f08c00'],
          'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'switchboard'], 2, 2.5],
        },
      },
      {
        id: 'obstacles',
        type: 'fill-extrusion',
        source: 'obstacles',
        paint: { 'fill-extrusion-color': '#868e96', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.85 },
      },
    ],
    terrain: { source: 'dem', exaggeration: p.exaggeration },
    sky: {
      'sky-color': '#9cc3e8',
      'horizon-color': '#e6eef5',
      'fog-color': '#e6eef5',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.9,
      'atmosphere-blend': 0,
    },
  }
}

/** VWorld WMS 레이어(지적도·용도지역)를 넣거나 뺀다. 지적도는 필지 윤곽 아래에 둔다. */
function setWms(map: MlMap, id: string, tiles: string[] | null, opacity: number, before: string) {
  if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource(id)) map.removeSource(id)
  if (!tiles) return
  map.addSource(id, { type: 'raster', tiles, tileSize: 256 })
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } }, before)
}

/**
 * 지형을 켠 채 처음 가는 곳으로 옮기면 그곳 높이 타일이 아직 없어 화면 중심의 높이를 0으로 잡는다.
 * 애니메이션 이동(fitBounds·flyTo·easeTo)은 끝난 뒤에도 이 높이를 고치지 않아서, 산지에서는 카메라가
 * 땅 높이에 붙은 채 필지보다 수백 m 앞쪽을 비춘다(3D에서만 위치가 틀리던 원인). 높이 타일이 들어올 때마다
 * 중심 높이와 실제 지면 높이를 비교해 다르면 같은 중심으로 jumpTo해 높이를 다시 잡는다.
 * 사용자가 지도를 움직였거나 새 이동이 시작됐으면 손대지 않는다.
 */
/** 필지가 화면에 다 들어오게 맞춘다. */
function fitParcel(map: MlMap, parcel: Parcel, pitch: number, bearing = map.getBearing()) {
  const pts = parcel.rings.flat()
  const lons = pts.map((c) => c[0])
  const lats = pts.map((c) => c[1])
  settle(map, () =>
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 19, pitch, bearing, duration: 600 },
    ),
  )
}

let settleSeq = 0
function settle(map: MlMap, move: () => void) {
  const seq = ++settleSeq
  move()
  let userMoved = false
  const onStart = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) userMoved = true
  }
  const fix = () => {
    if (userMoved || seq !== settleSeq || map.isMoving() || !map.terrain) return
    const center = map.getCenter()
    const ground = map.terrain.getElevationForLngLatZoom(center, map.transform.tileZoom)
    if (Math.abs(ground - map.getCenterElevation()) > 1) map.jumpTo({ center })
  }
  map.on('movestart', onStart)
  map.on('moveend', fix)
  map.on('sourcedata', fix)
  setTimeout(() => {
    map.off('movestart', onStart)
    map.off('moveend', fix)
    map.off('sourcedata', fix)
  }, 15000)
}

export default function Map3D(props: Props) {
  const { vworldKey, baseMap, showCadastral, showZoning, parcel, flyTo, sets, params, geometry, selected, obstacles, shadows, setShade, panelShade, terrainCells, terrainView, buildable, elec, exaggeration } = props
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const panels = useRef(new PanelLayer())
  const markers = useRef<maplibregl.Marker[]>([])
  const latest = useRef(props)
  latest.current = props
  // 스타일이 다 읽히기 전에 온 변경은 load 뒤에 한 번에 반영한다.
  const ready = useRef(false)
  const pending = useRef<Array<() => void>>([])
  const whenReady = (fn: () => void) => {
    if (ready.current && mapRef.current) fn()
    else pending.current.push(fn)
  }

  useEffect(() => {
    const v = shared.view
    const map = new maplibregl.Map({
      container: el.current!,
      style: initialStyle(latest.current),
      center: v ? [v.lon, v.lat] : [126.978, 37.5665],
      zoom: v ? v.zoom - 1 : 11,
      pitch: v?.pitch || 60,
      bearing: v?.bearing ?? 0,
      maxPitch: 85,
      maxZoom: 21,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => {
      map.addLayer(panels.current, 'obstacles')
      ready.current = true
      for (const fn of pending.current.splice(0)) fn()
    })
    // 지형 타일이 늦게 도착하면 판 높이를 다시 맞춘다.
    map.on('idle', () => {
      if (panels.current.refreshHeights()) panels.current.rebuild()
    })
    map.on('moveend', () => {
      if (latest.current.standalone) return
      const c = map.getCenter()
      shared.view = { lon: c.lng, lat: c.lat, zoom: map.getZoom() + 1, bearing: map.getBearing(), pitch: map.getPitch() }
    })
    map.on('click', (e) => {
      const p = latest.current
      const { lng: lon, lat } = e.lngLat
      if (p.tool === 'add') return p.onAddSet(lon, lat)
      if (p.tool === 'select') {
        const additive = e.originalEvent.shiftKey
        const hit = p.sets.find((s) => pointInRing([lon, lat], setQuadLonLat(s, p.geometry) as Vec[]))
        if (hit) p.onSelect([hit.id], additive)
        else if (!additive) p.onSelect([], false)
        return
      }
      p.onMapClick(lon, lat)
    })
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el.current!)
    mapRef.current = map
    return () => {
      ro.disconnect()
      ready.current = false
      pending.current = []
      for (const m of markers.current) m.remove()
      markers.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  // 배경지도: 키가 있으면 VWorld, 없으면 OSM. 위성일 때는 지명 겹침을 함께 깐다.
  const firstBase = useRef(true)
  useEffect(() => {
    if (firstBase.current) {
      firstBase.current = false
      return
    }
    whenReady(() => {
      const map = mapRef.current!
      const t = baseTiles(vworldKey, baseMap)
      ;(map.getSource('base') as maplibregl.RasterTileSource).setTiles(t.base)
      if (t.label) (map.getSource('label') as maplibregl.RasterTileSource).setTiles(t.label)
      map.setLayoutProperty('label', 'visibility', t.label ? 'visible' : 'none')
    })
  }, [vworldKey, baseMap])

  // 음영을 볼 때는 지형 음영을 고른 시각의 해 쪽에서 비추고 위성 위에도 깐다.
  const { sunLight, terrainShade } = props
  useEffect(() => {
    whenReady(() => {
      const map = mapRef.current!
      const base = baseMap === 'Base' || !vworldKey
      map.setLayoutProperty('hillshade', 'visibility', base || sunLight ? 'visible' : 'none')
      map.setPaintProperty('hillshade', 'hillshade-illumination-anchor', sunLight ? 'map' : 'viewport')
      map.setPaintProperty('hillshade', 'hillshade-illumination-direction', sunLight ? sunLight.bearing : 335)
      map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', sunLight ? Math.max(1, sunLight.altitude) : 45)
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', sunLight ? 0.5 : 0.35)
      map.setPaintProperty('hillshade', 'hillshade-shadow-color', sunLight ? '#0c1226' : '#2b2b2b')
      map.setPaintProperty('hillshade', 'hillshade-highlight-color', sunLight ? 'rgba(255, 244, 214, 0.25)' : '#ffffff')
    })
  }, [sunLight, baseMap, vworldKey])

  // 산 그림자 그림은 이 지도의 캔버스에 옮겨 그리고 캔버스 소스로 띄운다(그림 파일로 바꾸는 시간을 아낀다).
  const shadeCanvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    whenReady(() => {
      const map = mapRef.current!
      const src = map.getSource('terrain-shade') as maplibregl.CanvasSource | undefined
      if (!terrainShade) {
        if (map.getLayer('terrain-shade')) map.removeLayer('terrain-shade')
        if (src) map.removeSource('terrain-shade')
        return
      }
      const canvas = (shadeCanvas.current ??= document.createElement('canvas'))
      canvas.width = terrainShade.canvas.width
      canvas.height = terrainShade.canvas.height
      canvas.getContext('2d')!.drawImage(terrainShade.canvas, 0, 0)
      if (src) {
        src.setCoordinates(terrainShade.coordinates)
        // 정지 캔버스는 다시 올리지 않으므로 한 장면만 재생해 새 그림을 올린다.
        src.play()
        map.once('render', () => src.pause())
        map.triggerRepaint()
        return
      }
      map.addSource('terrain-shade', { type: 'canvas', canvas, coordinates: terrainShade.coordinates, animate: false })
      map.addLayer(
        { id: 'terrain-shade', type: 'raster', source: 'terrain-shade', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
        'terrain-fill',
      )
    })
  }, [terrainShade])

  useEffect(() => {
    whenReady(() =>
      setWms(mapRef.current!, 'cadastral', showCadastral && vworldKey ? [wmsTiles(CADASTRAL_WMS, vworldKey)] : null, 0.9, 'terrain-fill'),
    )
  }, [vworldKey, showCadastral])

  useEffect(() => {
    whenReady(() =>
      setWms(mapRef.current!, 'zoning', showZoning && vworldKey ? [wmsTiles(ZONING_WMS, vworldKey)] : null, 0.55, 'terrain-fill'),
    )
  }, [vworldKey, showZoning])

  const { camera } = props
  useEffect(() => {
    if (!camera) return
    whenReady(() => {
      const map = mapRef.current!
      const parcel = latest.current.parcel
      if (camera.bearing !== undefined) map.easeTo({ pitch: 78, bearing: camera.bearing, duration: 900 })
      else if (camera.view === 'fit') {
        if (parcel) fitParcel(map, parcel, CAMERA.persp.pitch, CAMERA.persp.bearing)
      } else map.easeTo({ ...CAMERA[camera.view], duration: 700 })
    })
  }, [camera])

  useEffect(() => {
    whenReady(() => mapRef.current!.setTerrain({ source: 'dem', exaggeration }))
  }, [exaggeration])

  const fittedHere = useRef<Parcel | null>(null)
  useEffect(() => {
    whenReady(() => {
      const map = mapRef.current!
      const setback: GeoJSON.Feature[] = parcel
        ? [{ type: 'Feature', properties: { kind: 'setback' }, geometry: { type: 'MultiLineString', coordinates: setbackRings(parcel, latest.current.params) } }]
        : []
      ;(map.getSource('parcel') as GeoJSONSource).setData(fc(parcel ? [...parcel.rings.map((r) => poly([r])), ...setback] : []))
      if (!parcel) return
      if (latest.current.standalone) {
        if (fittedHere.current === parcel) return
        fittedHere.current = parcel
        return fitParcel(map, parcel, CAMERA.persp.pitch, CAMERA.persp.bearing)
      }
      if (shared.fitted === parcel) return
      shared.fitted = parcel
      fitParcel(map, parcel, map.getPitch() || 60)
    })
    // 경계 이격 값이 바뀔 때도 이격선을 다시 그린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel, params.boundarySetback, params.edgeSetbacks])

  useEffect(() => {
    if (!flyTo || shared.flySeq === flyTo.seq) return
    shared.flySeq = flyTo.seq
    whenReady(() => {
      const map = mapRef.current!
      settle(map, () => map.flyTo({ center: [flyTo.lon, flyTo.lat] as LngLatLike, zoom: (flyTo.zoom ?? 18) - 1, duration: 800 }))
    })
  }, [flyTo])

  useEffect(() => {
    whenReady(() => panels.current.update(latest.current))
  }, [sets, params, geometry, selected, setShade, panelShade, elec])

  useEffect(() => {
    whenReady(() =>
      (mapRef.current!.getSource('obstacles') as GeoJSONSource).setData(
        fc(obstacles.map((o) => poly([o.ring], { height: o.height }))),
      ),
    )
  }, [obstacles])

  useEffect(() => {
    whenReady(() =>
      (mapRef.current!.getSource('shadows') as GeoJSONSource).setData(
        fc(shadows.map((s) => poly([s.ring], { fromSet: s.fromSet }))),
      ),
    )
  }, [shadows])

  useEffect(() => {
    whenReady(() => {
      const show = terrainCells && (terrainView === 'slope' || terrainView === 'cutfill')
      ;(mapRef.current!.getSource('terrain') as GeoJSONSource).setData(
        fc(
          show
            ? terrainCells.map((c) =>
                poly([c.ring], {
                  mode: terrainView,
                  cls: terrainView === 'cutfill' ? cutFillClass(c.dz) : slopeClass(c.slopePct),
                }),
              )
            : [],
        ),
      )
    })
  }, [terrainCells, terrainView])

  useEffect(() => {
    whenReady(() => {
      const feats: GeoJSON.Feature[] = []
      if (buildable && terrainView === 'buildable') {
        for (const e of buildable.excluded) feats.push(poly([e.ring], { kind: e.kind }))
        for (const [a, b] of buildable.channels)
          feats.push({ type: 'Feature', properties: { kind: 'channel' }, geometry: { type: 'LineString', coordinates: [a, b] } })
      }
      ;(mapRef.current!.getSource('buildable') as GeoJSONSource).setData(fc(feats))
    })
  }, [buildable, terrainView])

  useEffect(() => {
    whenReady(() => {
      const map = mapRef.current!
      for (const m of markers.current) m.remove()
      markers.current = []
      const feats: GeoJSON.Feature[] = []
      if (elec) {
        const label = (text: string, at: number[]) => {
          const div = document.createElement('div')
          div.className = 'map3d-label'
          div.textContent = text
          markers.current.push(new maplibregl.Marker({ element: div, anchor: 'bottom', offset: [0, -10] }).setLngLat(at as [number, number]).addTo(map))
        }
        for (const inv of elec.inverters) {
          feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: inv.path } })
          feats.push({ type: 'Feature', properties: { kind: 'inverter' }, geometry: { type: 'Point', coordinates: inv.lonlat } })
          label(`INV-${inv.id}`, inv.lonlat)
        }
        feats.push({ type: 'Feature', properties: { kind: 'switchboard' }, geometry: { type: 'Point', coordinates: elec.switchboard } })
        label(elec.switchboardLabel, elec.switchboard)
      }
      ;(map.getSource('elec') as GeoJSONSource).setData(fc(feats))
    })
  }, [elec])

  return <div ref={el} className={`map map3d tool-${props.tool}`} />
}
