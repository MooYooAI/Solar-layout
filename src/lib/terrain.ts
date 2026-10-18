// 지형 표고와 경사·절성토 분석.
// 표고는 AWS 공개 지형 타일(Terrarium 형식, 키 불필요, CORS 허용)을 쓴다. 국내는 SRTM 기반이라
// 원자료 해상도가 약 30m이므로 개략 검토용이다. 정밀 토공은 실측 또는 5m DEM으로 다시 해야 한다.

import { deg2rad, LocalFrame, pointInRing, rad2deg, type Vec } from './geo'
import type { Parcel } from './parcel'

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TILE = 256

export interface Dem {
  /** 경위도 위치의 표고(m), 쌍선형 보간 */
  elevation: (lon: number, lat: number) => number
  zoom: number
}

function lonLatToPixel(lon: number, lat: number, z: number): Vec {
  const n = TILE * 2 ** z
  const x = ((lon + 180) / 360) * n
  const s = Math.sin(deg2rad(lat))
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n
  return [x, y]
}

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array> {
  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`표고 타일을 받지 못했습니다 (${res.status}).`)
  const bmp = await createImageBitmap(await res.blob())
  const canvas = new OffscreenCanvas(TILE, TILE)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  const { data } = ctx.getImageData(0, 0, TILE, TILE)
  const out = new Float32Array(TILE * TILE)
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768
  return out
}

/** 필지 주변(여유 margin m)을 덮는 표고 타일을 받아 보간 함수를 만든다. */
export async function loadDem(parcel: Parcel, zoom = 15, margin = 30): Promise<Dem> {
  const frame = LocalFrame.around(parcel.rings)
  const pts = parcel.rings.flat().map((c) => frame.toLocal(c))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const sw = frame.toLonLat([Math.min(...xs) - margin, Math.min(...ys) - margin])
  const ne = frame.toLonLat([Math.max(...xs) + margin, Math.max(...ys) + margin])
  return loadDemBounds(sw, ne, zoom)
}

/** 경위도 사각형(남서·북동)을 덮는 표고 타일을 받아 보간 함수를 만든다. */
export async function loadDemBounds(sw: Vec, ne: Vec, zoom: number): Promise<Dem> {
  const [px0, py1] = lonLatToPixel(sw[0], sw[1], zoom)
  const [px1, py0] = lonLatToPixel(ne[0], ne[1], zoom)
  const tx0 = Math.floor(px0 / TILE)
  const tx1 = Math.floor(px1 / TILE)
  const ty0 = Math.floor(py0 / TILE)
  const ty1 = Math.floor(py1 / TILE)
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) throw new Error('필지가 너무 커서 표고를 한 번에 받을 수 없습니다.')
  const tiles = new Map<string, Float32Array>()
  const jobs: Promise<void>[] = []
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++)
      jobs.push(fetchTile(zoom, tx, ty).then((t) => void tiles.set(`${tx},${ty}`, t)))
  await Promise.all(jobs)

  const at = (px: number, py: number) => {
    const tx = Math.floor(px / TILE)
    const ty = Math.floor(py / TILE)
    const t = tiles.get(`${tx},${ty}`)
    if (!t) return NaN
    return t[(py - ty * TILE) * TILE + (px - tx * TILE)]
  }
  return {
    zoom,
    elevation(lon, lat) {
      const [x, y] = lonLatToPixel(lon, lat, zoom)
      const fx = x - 0.5
      const fy = y - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const dx = fx - x0
      const dy = fy - y0
      return (
        at(x0, y0) * (1 - dx) * (1 - dy) +
        at(x0 + 1, y0) * dx * (1 - dy) +
        at(x0, y0 + 1) * (1 - dx) * dy +
        at(x0 + 1, y0 + 1) * dx * dy
      )
    },
  }
}

export type GradingMode = 'plane' | 'flat'

export interface TerrainOptions {
  /** 분석 격자 크기(m) */
  cell: number
  /** plane: 지형을 따르는 평면(경사 상한 적용), flat: 수평 정지 */
  mode: GradingMode
  /** plane 모드에서 계획면의 최대 경사(%) */
  maxDesignSlopePct: number
}

export interface TerrainCell {
  /** 셀 네 꼭짓점(경위도, 닫힌 링) */
  ring: Vec[]
  ground: number
  slopePct: number
  /** 경사면이 향하는 방향(도), 북 0 시계방향 */
  aspect: number
  design: number
  /** 계획고 − 지반고: + 성토, − 절토 */
  dz: number
}

export interface TerrainResult {
  cells: TerrainCell[]
  cellArea: number
  minZ: number
  maxZ: number
  meanSlopePct: number
  maxSlopePct: number
  /** 경사 구간별 면적 비율: [0~5, 5~10, 10~15, 15~20, 20%~] */
  slopeClasses: number[]
  /** 남향(남동~남서) 비탈 면적 비율 */
  southFacing: number
  design: { slopePct: number; aspect: number }
  cut: number // ㎥
  fill: number // ㎥
  maxCut: number // m
  maxFill: number // m
}

export const SLOPE_BREAKS = [5, 10, 15, 20]

export function analyzeTerrain(parcel: Parcel, dem: Dem, o: TerrainOptions): TerrainResult {
  const frame = LocalFrame.around(parcel.rings)
  const rings = parcel.rings.map((r) => r.map((c) => frame.toLocal(c)))
  const pts = rings.flat()
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  // 셀 수가 너무 많아지지 않게 격자를 키운다.
  let cell = Math.max(0.5, o.cell)
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > 25000) cell *= 1.5
  const h = cell
  const z = (x: number, y: number) => {
    const [lon, lat] = frame.toLonLat([x, y])
    return dem.elevation(lon, lat)
  }

  type Raw = { x: number; y: number; ground: number; gx: number; gy: number }
  const raw: Raw[] = []
  for (let y = minY + cell / 2; y < maxY; y += cell)
    for (let x = minX + cell / 2; x < maxX; x += cell) {
      if (!rings.some((r) => pointInRing([x, y], r))) continue
      const ground = z(x, y)
      if (!Number.isFinite(ground)) continue
      raw.push({ x, y, ground, gx: (z(x + h, y) - z(x - h, y)) / (2 * h), gy: (z(x, y + h) - z(x, y - h)) / (2 * h) })
    }
  if (!raw.length) throw new Error('필지 안에서 표고를 읽지 못했습니다.')

  // 계획면: 최소제곱 평면 z = a + b·x + c·y, 경사 상한을 넘으면 기울기만 줄이고 높이는 절성토가 같아지도록 맞춘다.
  let b = 0
  let c = 0
  if (o.mode === 'plane') {
    const n = raw.length
    const mx = raw.reduce((s, r) => s + r.x, 0) / n
    const my = raw.reduce((s, r) => s + r.y, 0) / n
    const mz = raw.reduce((s, r) => s + r.ground, 0) / n
    let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0
    for (const r of raw) {
      const dx = r.x - mx, dy = r.y - my, dz = r.ground - mz
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz
    }
    const det = sxx * syy - sxy * sxy
    if (Math.abs(det) > 1e-9) {
      b = (sxz * syy - syz * sxy) / det
      c = (syz * sxx - sxz * sxy) / det
    }
    const g = Math.hypot(b, c)
    const lim = o.maxDesignSlopePct / 100
    if (g > lim) {
      b *= lim / g
      c *= lim / g
    }
  }
  const a = raw.reduce((s, r) => s + r.ground - b * r.x - c * r.y, 0) / raw.length

  const area = cell * cell
  const classes = [0, 0, 0, 0, 0]
  let cut = 0, fill = 0, maxCut = 0, maxFill = 0, slopeSum = 0, maxSlope = 0, south = 0
  let minZ = Infinity, maxZ = -Infinity
  const cells: TerrainCell[] = raw.map((r) => {
    const slopePct = 100 * Math.hypot(r.gx, r.gy)
    // 내리막 방향 = −기울기 벡터. 북 0, 동 90.
    const aspect = (rad2deg(Math.atan2(-r.gx, -r.gy)) + 360) % 360
    const design = a + b * r.x + c * r.y
    const dz = design - r.ground
    if (dz > 0) { fill += dz * area; maxFill = Math.max(maxFill, dz) } else { cut += -dz * area; maxCut = Math.max(maxCut, -dz) }
    slopeSum += slopePct
    maxSlope = Math.max(maxSlope, slopePct)
    classes[SLOPE_BREAKS.filter((br) => slopePct >= br).length]++
    if (slopePct >= 2 && aspect >= 135 && aspect <= 225) south++
    minZ = Math.min(minZ, r.ground)
    maxZ = Math.max(maxZ, r.ground)
    const half = cell / 2
    const ring = ([[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]] as Vec[]).map(([dx, dy]) =>
      frame.toLonLat([r.x + dx, r.y + dy]),
    )
    return { ring, ground: r.ground, slopePct, aspect, design, dz }
  })
  const n = cells.length
  return {
    cells,
    cellArea: area,
    minZ,
    maxZ,
    meanSlopePct: slopeSum / n,
    maxSlopePct: maxSlope,
    slopeClasses: classes.map((k) => k / n),
    southFacing: south / n,
    design: { slopePct: 100 * Math.hypot(b, c), aspect: (rad2deg(Math.atan2(-b, -c)) + 360) % 360 },
    cut,
    fill,
    maxCut,
    maxFill,
  }
}

/** 경사(%) → 각도(°) */
export const pctToDeg = (pct: number) => rad2deg(Math.atan(pct / 100))
