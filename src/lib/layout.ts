import { deg2rad, LocalFrame, quadFitsInRing, rotate, type Vec } from './geo'
import type { Parcel } from './parcel'
import { blockedAt, type BuildMask } from './buildable'
import type { RackingType } from './catalog'

export interface LayoutParams {
  /** 모듈 긴 변(mm) */
  moduleLength: number
  /** 모듈 짧은 변(mm) */
  moduleWidth: number
  /** 모듈 1장 출력(W) */
  moduleWatt: number
  /** 세로 배치(긴 변이 경사 방향) 여부 */
  portrait: boolean
  /** 세트 하나의 가로 모듈 수 */
  setCols: number
  /** 세트 하나의 경사 방향 모듈 수(단) */
  setRows: number
  /** 모듈 패널 간 간격(mm) */
  moduleGap: number
  /** 같은 열에서 옆 세트와의 간격(mm) */
  setGap: number
  /** 앞뒤 열 세트 사이 이격거리(m): 앞 세트 뒤끝 ~ 뒷 세트 앞끝 */
  rowSpacing: number
  /** 필지 경계로부터 이격거리(m) */
  boundarySetback: number
  /** 경사각(도) */
  tilt: number
  /** 세트가 바라보는 방향(도). 남 0, 서 +, 동 − */
  azimuth: number
  /** 세트 하단의 지면 높이(m) */
  groundClearance: number
  /** 구조물(래킹) 방식: 지형 허용 경사와 토공, 구조물 단가가 달라진다 */
  racking: RackingType
}

export const DEFAULT_PARAMS: LayoutParams = {
  moduleLength: 2278,
  moduleWidth: 1134,
  moduleWatt: 550,
  portrait: true,
  setCols: 10,
  setRows: 2,
  moduleGap: 20,
  setGap: 500,
  rowSpacing: 4,
  boundarySetback: 1,
  tilt: 30,
  azimuth: 0,
  groundClearance: 0.5,
  racking: 'pile',
}

/** 모듈 세트(어레이 테이블). 좌표는 경위도 중심 + 회전. */
export interface ModuleSet {
  id: string
  lon: number
  lat: number
  /** 세트 방향(도), 남 0, 서 + */
  azimuth: number
}

export interface SetGeometry {
  /** 동서 방향 폭(m) */
  width: number
  /** 경사면 길이(m) */
  slope: number
  /** 지면 투영 깊이(m) */
  depth: number
  /** 상단 높이(m) */
  height: number
  modules: number
  watt: number
}

export function setGeometry(p: LayoutParams): SetGeometry {
  const along = (p.portrait ? p.moduleWidth : p.moduleLength) / 1000
  const across = (p.portrait ? p.moduleLength : p.moduleWidth) / 1000
  const gap = p.moduleGap / 1000
  const width = p.setCols * along + (p.setCols - 1) * gap
  const slope = p.setRows * across + (p.setRows - 1) * gap
  const t = deg2rad(p.tilt)
  const modules = p.setCols * p.setRows
  return {
    width,
    slope,
    depth: slope * Math.cos(t),
    height: p.groundClearance + slope * Math.sin(t),
    modules,
    watt: modules * p.moduleWatt,
  }
}

// 세트 로컬 좌표: +x 동쪽, +y 북쪽(뒤). 남쪽을 보던 세트가 서쪽(+)으로 돌면
// 지도에서는 시계 방향 회전이므로 반시계 기준 회전각은 −azimuth.
const mapRotation = (azimuthDeg: number) => -deg2rad(azimuthDeg)

/** 세트 중심 기준 지면 투영 사각형(로컬 m) */
export function setQuadLocal(center: Vec, azimuthDeg: number, g: SetGeometry): Vec[] {
  const hw = g.width / 2
  const hd = g.depth / 2
  const r = mapRotation(azimuthDeg)
  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as Vec[]
  ).map((c) => {
    const [x, y] = rotate(c, r)
    return [x + center[0], y + center[1]] as Vec
  })
}

export function setQuadLonLat(s: ModuleSet, g: SetGeometry): Vec[] {
  const f = new LocalFrame(s.lon, s.lat)
  const q = setQuadLocal([0, 0], s.azimuth, g).map((v) => f.toLonLat(v))
  return [...q, q[0]]
}

let idSeq = 0
export const newSetId = () => `s${Date.now().toString(36)}${(idSeq++).toString(36)}`

/**
 * 필지 안에 세트를 자동으로 채운다.
 * 세트 방향 기준으로 좌표를 돌린 뒤, 남쪽 열부터 열마다 왼쪽에서 오른쪽으로 들어가는 자리에 채운다.
 * rowOffset(m)만큼 첫 열을 북쪽으로 밀어 시작할 수 있다. 같은 간격이라도 시작 위치에 따라 들어가는 세트 수가 달라진다.
 * mask(설계 가능 영역)를 주면 경사·배수 제외 구역에 걸치는 자리는 건너뛴다.
 */
export function autoLayout(parcel: Parcel, p: LayoutParams, rowOffset = 0, mask?: BuildMask | null): ModuleSet[] {
  const g = setGeometry(p)
  if (g.width <= 0 || g.depth <= 0) return []
  const frame = LocalFrame.around(parcel.rings)
  const r = mapRotation(p.azimuth)
  // 세트 좌표계: x = 세트 폭 방향, y = 남→북(앞→뒤)
  const rings = parcel.rings.map((ring) => ring.map((c) => rotate(frame.toLocal(c), -r)))
  const out: ModuleSet[] = []
  const rowPitch = g.depth + p.rowSpacing
  const colPitch = g.width + p.setGap / 1000
  const step = 0.25
  const blocked = mask ? footprintBlocked(mask, frame, g) : null

  for (const ring of rings) {
    const xs = ring.map((v) => v[0])
    const ys = ring.map((v) => v[1])
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
    for (let cy = minY + p.boundarySetback + g.depth / 2 + rowOffset; cy + g.depth / 2 <= maxY; cy += rowPitch) {
      let cx = minX + p.boundarySetback + g.width / 2
      while (cx + g.width / 2 <= maxX) {
        const quad = setQuadLocal([cx, cy], 0, g)
        if (quadFitsInRing(quad, ring, p.boundarySetback) && !blocked?.(cx, cy, r)) {
          const [lon, lat] = frame.toLonLat(rotate([cx, cy], r))
          out.push({ id: newSetId(), lon, lat, azimuth: p.azimuth })
          cx += colPitch
        } else {
          cx += step
        }
      }
    }
  }
  return out
}

/**
 * 세트 좌표계(세트 방향으로 돌린 필지 좌표) 중심 (cx, cy)에 놓인 세트 바닥이 제외 구역에 걸치는지.
 * 마스크 셀 반 크기(최대 1.5m) 간격으로 바닥을 훑는다.
 */
function footprintBlocked(mask: BuildMask, frame: LocalFrame, g: SetGeometry) {
  const sameFrame = Math.abs(mask.lon0 - frame.lon0) < 1e-12 && Math.abs(mask.lat0 - frame.lat0) < 1e-12
  const maskFrame = new LocalFrame(mask.lon0, mask.lat0)
  const toMask = (v: Vec): Vec => (sameFrame ? v : maskFrame.toLocal(frame.toLonLat(v)))
  const d = Math.min(1.5, mask.cell / 2)
  const nu = Math.max(1, Math.ceil(g.width / d))
  const nv = Math.max(1, Math.ceil(g.depth / d))
  return (cx: number, cy: number, r: number) => {
    for (let a = 0; a <= nu; a++)
      for (let b = 0; b <= nv; b++) {
        const local = rotate([cx - g.width / 2 + (a * g.width) / nu, cy - g.depth / 2 + (b * g.depth) / nv], r)
        const [x, y] = toMask(local)
        if (blockedAt(mask, x, y)) return true
      }
    return false
  }
}

/** 세트 안 모듈 한 장씩의 지면 투영 사각형(경위도). 지도에 패널 줄눈을 그리는 용도. */
export function moduleQuadsLonLat(s: ModuleSet, p: LayoutParams, g: SetGeometry): Vec[][] {
  const f = new LocalFrame(s.lon, s.lat)
  const r = mapRotation(s.azimuth)
  const cos = Math.cos(deg2rad(p.tilt))
  const along = (p.portrait ? p.moduleWidth : p.moduleLength) / 1000
  const across = ((p.portrait ? p.moduleLength : p.moduleWidth) / 1000) * cos
  const gapX = p.moduleGap / 1000
  const gapY = gapX * cos
  const quads: Vec[][] = []
  for (let row = 0; row < p.setRows; row++) {
    const y0 = -g.depth / 2 + row * (across + gapY)
    for (let col = 0; col < p.setCols; col++) {
      const x0 = -g.width / 2 + col * (along + gapX)
      const q = (
        [
          [x0, y0],
          [x0 + along, y0],
          [x0 + along, y0 + across],
          [x0, y0 + across],
        ] as Vec[]
      ).map((c) => f.toLonLat(rotate(c, r)))
      quads.push([...q, q[0]])
    }
  }
  return quads
}

export interface LayoutStats {
  sets: number
  modules: number
  kWp: number
  /** 모듈 지면 투영 면적 / 필지 면적 */
  coverage: number
}

export function layoutStats(sets: ModuleSet[], g: SetGeometry, parcelArea: number): LayoutStats {
  const modules = sets.length * g.modules
  return {
    sets: sets.length,
    modules,
    kWp: (sets.length * g.watt) / 1000,
    coverage: parcelArea > 0 ? (sets.length * g.width * g.depth) / parcelArea : 0,
  }
}
