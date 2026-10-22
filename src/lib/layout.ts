import { convexHull, deg2rad, LocalFrame, quadFitsInRing, rotate, type Vec } from './geo'
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

/**
 * 연속 배열: 세트를 기둥 한 칸(세로 배치 2열, 가로 배치 1열) 단위로 줄이고 모듈 간격으로 이어 붙인다.
 * 줄이 고정 길이 세트로 끊기지 않아 비스듬한 경계 끝까지 모듈이 들어간다. 전기 스트링은 세트를 넘어 묶이므로 그대로 쓴다.
 */
export function continuousParams(p: LayoutParams): LayoutParams {
  return { ...p, setCols: p.portrait ? 2 : 1, setGap: p.moduleGap }
}
/** 연속 배열 설정인지(세트 사이가 모듈 간격만큼만 떨어져 있다) */
export const isContinuous = (p: LayoutParams) => p.setGap <= p.moduleGap

let idSeq = 0
export const newSetId = () => `s${Date.now().toString(36)}${(idSeq++).toString(36)}`

/**
 * 필지 안에 세트를 자동으로 채운다.
 * 세트 방향 기준으로 좌표를 돌린 뒤, 남쪽 열부터 열마다 왼쪽에서 오른쪽으로 들어가는 자리에 채운다.
 * rowOffset(m)만큼 첫 열을 북쪽으로 밀어 시작할 수 있다. 같은 간격이라도 시작 위치에 따라 들어가는 세트 수가 달라진다.
 * mask(설계 가능 영역)를 주면 경사·배수 제외 구역에 걸치는 자리는 건너뛴다.
 */
export function autoLayout(parcel: Parcel, p: LayoutParams, rowOffset = 0, mask?: BuildMask | null, keepOut?: number[][][]): ModuleSet[] {
  return fillLayout(parcel, p, { rowOffset, mask, keepOut })
}

export interface FillOptions {
  rowOffset?: number
  mask?: BuildMask | null
  /** 세트 바닥 네 꼭짓점(필지 중심 기준 로컬 m)이 이 구역에 들어가는 자리만 쓴다. */
  accept?: (quad: Vec[]) => boolean
  /** 이미 놓인 세트. 이 세트들과 겹치거나 간격을 침범하는 자리는 건너뛴다. 새로 놓은 세트도 여기에 더한다. */
  occupied?: Occupancy
  /** 모듈을 놓지 않을 자리(경위도 링): 전기실, 장애물 바닥. 볼록 껍질로 판정한다. */
  keepOut?: number[][][]
}

/** autoLayout의 일반형. 구역 제한과 이미 놓인 세트를 피해 채운다(구역별 배치·빈자리 채우기). */
export function fillLayout(parcel: Parcel, p: LayoutParams, o: FillOptions = {}): ModuleSet[] {
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
  const blocked = o.mask ? footprintBlocked(o.mask, frame, g) : null
  const rowOffset = o.rowOffset ?? 0
  const toFrame = (q: Vec[]) => q.map((v) => rotate(v, r))
  const keep = (o.keepOut ?? []).filter((k) => k.length >= 3).map((k) => convexHull(k.map((c) => frame.toLocal(c))))

  for (const ring of rings) {
    const xs = ring.map((v) => v[0])
    const ys = ring.map((v) => v[1])
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
    for (let cy = minY + p.boundarySetback + g.depth / 2 + rowOffset; cy + g.depth / 2 <= maxY; cy += rowPitch) {
      let cx = minX + p.boundarySetback + g.width / 2
      while (cx + g.width / 2 <= maxX) {
        const quad = setQuadLocal([cx, cy], 0, g)
        const ok =
          quadFitsInRing(quad, ring, p.boundarySetback) &&
          !blocked?.(cx, cy, r) &&
          (!o.accept || o.accept(toFrame(quad))) &&
          (!keep.length || !keep.some((k) => convexOverlap(toFrame(quad), k))) &&
          (!o.occupied || o.occupied.free(toFrame(quad), toFrame(clearanceQuad([cx, cy], g, p))))
        if (ok) {
          const [lon, lat] = frame.toLonLat(rotate([cx, cy], r))
          out.push({ id: newSetId(), lon, lat, azimuth: p.azimuth })
          o.occupied?.add(toFrame(quad), toFrame(clearanceQuad([cx, cy], g, p)))
          cx += colPitch
        } else {
          cx += step
        }
      }
    }
  }
  return out
}

/** 세트 바닥을 옆으로 세트 간격, 앞뒤로 열 이격거리만큼 넓힌 사각형(세트 좌표계). 다른 세트가 들어오면 안 되는 범위. */
function clearanceQuad(center: Vec, g: SetGeometry, p: LayoutParams): Vec[] {
  // 경계에 딱 맞닿는 이웃은 허용하도록 조금 줄인다.
  const gx = Math.max(0, p.setGap / 1000 - 0.01)
  const gy = Math.max(0, p.rowSpacing - 0.01)
  const [cx, cy] = center
  const hw = g.width / 2 + gx
  const hd = g.depth / 2 + gy
  return [
    [cx - hw, cy - hd],
    [cx + hw, cy - hd],
    [cx + hw, cy + hd],
    [cx - hw, cy + hd],
  ]
}

/**
 * 이미 놓인 세트 바닥과 그 간격 범위(필지 중심 기준 로컬 m). 방향이 다른 세트끼리도 겹침을 판정한다.
 * 새 세트는 남의 간격 범위를 침범하지 않고, 자기 간격 범위에 남의 바닥이 들어오지 않아야 한다.
 */
export class Occupancy {
  private readonly cells = new Map<string, number[]>()
  private readonly items: Array<{ quad: Vec[]; clear: Vec[] }> = []
  private static readonly CELL = 10

  /** 이미 있는 세트로 채운다. */
  static from(parcel: Parcel, sets: ModuleSet[], p: LayoutParams): Occupancy {
    const occ = new Occupancy()
    const g = setGeometry(p)
    const frame = LocalFrame.around(parcel.rings)
    for (const s of sets) {
      const r = mapRotation(s.azimuth)
      const c = frame.toLocal([s.lon, s.lat])
      const place = (q: Vec[]) => q.map((v) => {
        const [x, y] = rotate(v, r)
        return [x + c[0], y + c[1]] as Vec
      })
      occ.add(place(setQuadLocal([0, 0], 0, g)), place(clearanceQuad([0, 0], g, p)))
    }
    return occ
  }

  add(quad: Vec[], clear: Vec[]) {
    const i = this.items.length
    this.items.push({ quad, clear })
    for (const key of this.keys(clear)) {
      const list = this.cells.get(key)
      if (list) list.push(i)
      else this.cells.set(key, [i])
    }
  }

  free(quad: Vec[], clear: Vec[]): boolean {
    const seen = new Set<number>()
    for (const key of this.keys(clear))
      for (const i of this.cells.get(key) ?? []) {
        if (seen.has(i)) continue
        seen.add(i)
        const it = this.items[i]
        if (convexOverlap(clear, it.quad) || convexOverlap(quad, it.clear)) return false
      }
    return true
  }

  private keys(q: Vec[]): string[] {
    const C = Occupancy.CELL
    const xs = q.map((v) => v[0])
    const ys = q.map((v) => v[1])
    const out: string[] = []
    for (let i = Math.floor(Math.min(...xs) / C); i <= Math.floor(Math.max(...xs) / C); i++)
      for (let j = Math.floor(Math.min(...ys) / C); j <= Math.floor(Math.max(...ys) / C); j++) out.push(`${i},${j}`)
    return out
  }
}

/** 볼록 다각형 두 개가 겹치는지(분리축 판정). 변이 맞닿기만 하면 겹치지 않은 것으로 본다. */
function convexOverlap(a: Vec[], b: Vec[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]
      const [x2, y2] = poly[(i + 1) % poly.length]
      const nx = y1 - y2
      const ny = x2 - x1
      let minA = Infinity
      let maxA = -Infinity
      for (const [x, y] of a) {
        const d = x * nx + y * ny
        minA = Math.min(minA, d)
        maxA = Math.max(maxA, d)
      }
      let minB = Infinity
      let maxB = -Infinity
      for (const [x, y] of b) {
        const d = x * nx + y * ny
        minB = Math.min(minB, d)
        maxB = Math.max(maxB, d)
      }
      if (maxA <= minB + 1e-9 || maxB <= minA + 1e-9) return false
    }
  return true
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

/**
 * 3D 보기용 모듈 사각형. 세트 중심 기준 로컬 좌표(m, +x 동, +y 북)와 지면 위 높이(m).
 * 앞(남쪽) 끝이 지상고에서 시작해 경사각만큼 올라간다.
 */
export function moduleQuads3D(s: ModuleSet, p: LayoutParams, g: SetGeometry): Array<Array<[number, number, number]>> {
  const r = mapRotation(s.azimuth)
  const t = deg2rad(p.tilt)
  const cos = Math.cos(t)
  const tan = Math.tan(t)
  const along = (p.portrait ? p.moduleWidth : p.moduleLength) / 1000
  const across = ((p.portrait ? p.moduleLength : p.moduleWidth) / 1000) * cos
  const gapX = p.moduleGap / 1000
  const gapY = gapX * cos
  const lift = (y: number) => p.groundClearance + (y + g.depth / 2) * tan
  const quads: Array<Array<[number, number, number]>> = []
  for (let row = 0; row < p.setRows; row++) {
    const y0 = -g.depth / 2 + row * (across + gapY)
    for (let col = 0; col < p.setCols; col++) {
      const x0 = -g.width / 2 + col * (along + gapX)
      const corners: Vec[] = [
        [x0, y0],
        [x0 + along, y0],
        [x0 + along, y0 + across],
        [x0, y0 + across],
      ]
      quads.push(corners.map((c) => [...rotate(c, r), lift(c[1])] as [number, number, number]))
    }
  }
  return quads
}

/** 3D 보기용 가대 기둥 위치: 세트 로컬 좌표(m)와 기둥 높이(m). 앞뒤 두 줄. */
export function setPosts3D(s: ModuleSet, p: LayoutParams, g: SetGeometry): Array<[number, number, number]> {
  const r = mapRotation(s.azimuth)
  const n = Math.max(2, Math.ceil(g.width / 3) + 1)
  const inset = Math.min(0.3, g.width / 4)
  const out: Array<[number, number, number]> = []
  const yF = -g.depth / 2 + Math.min(0.2, g.depth / 4)
  const yB = g.depth / 2 - Math.min(0.2, g.depth / 4)
  const tan = Math.tan(deg2rad(p.tilt))
  for (let i = 0; i < n; i++) {
    const x = -g.width / 2 + inset + ((g.width - 2 * inset) * i) / (n - 1)
    for (const y of [yF, yB]) out.push([...rotate([x, y], r), p.groundClearance + (y + g.depth / 2) * tan])
  }
  return out
}
