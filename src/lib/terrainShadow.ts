// 산·언덕이 땅에 드리우는 그림자 지도. 부지 주변 표고를 격자로 깔아 두고, 칸마다 해 쪽으로 광선을 따라가
// 앞을 막는 지형이 있는지(드리운 그림자), 칸의 비탈이 해를 등지는지(자기 그림자)를 본다.
// 결과는 반투명 그림으로 만들어 3D 지형 위에 덮는다. 표고 해상도(약 30 m)만큼 거친 그림자다.
// 계산이 무거워서(그림 한 장에 수십~수백 ms) 워커에서 돌리고, 화면은 새 그림이 올 때까지 앞 그림을 둔다.

import { deg2rad } from './geo'
import type { SiteDem } from './horizon'
import type { SunPos } from './sun'

/** 지도에 덮을 그림(캔버스, 위가 북)과 네 모서리(경위도: 왼위, 오른위, 오른아래, 왼아래) */
export interface TerrainShadeImage {
  canvas: HTMLCanvasElement
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
}

/** 부지 중심 기준 표고 격자. 워커로 넘기는 값이다. */
export interface ShadeGrid {
  z: Float32Array
  n: number
  half: number
  maxZ: number
}

/** 표고 격자 간격(m). 원자료 해상도와 비슷하게 둔다. */
const DEM_CELL = 30
/** 그림자 지도 칸(m)과 반폭(m). 부지 반경 1 km만 그린다. 그 밖의 산이 드리우는 그림자도 광선이 표고 격자 끝까지 따라가므로 빠지지 않는다. */
const OUT_CELL = 8
const OUT_HALF = 1000
const OUT_SIZE = Math.round((2 * OUT_HALF) / OUT_CELL)
/** 광선이 이 거리(m)를 넘으면 그만 본다 */
const MAX_REACH = 6000

/** 부지 중심 기준 로컬 (x, y) m의 표고(쌍선형). 격자 밖은 NaN */
function at(g: ShadeGrid, x: number, y: number): number {
  const fx = (x + g.half) / DEM_CELL
  const fy = (y + g.half) / DEM_CELL
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  if (i < 0 || j < 0 || i >= g.n - 1 || j >= g.n - 1) return NaN
  const tx = fx - i
  const ty = fy - j
  const k = j * g.n + i
  const z = g.z
  return z[k] * (1 - tx) * (1 - ty) + z[k + 1] * tx * (1 - ty) + z[k + g.n] * (1 - tx) * ty + z[k + g.n + 1] * tx * ty
}

/** 이 해 위치에서 그늘진 칸을 칠한 RGBA 픽셀(OUT_SIZE², 위가 북). 해가 지평선 아래면 null. */
export function shadePixels(g: ShadeGrid, sun: SunPos): Uint8ClampedArray<ArrayBuffer> | null {
  if (sun.altitude <= deg2rad(0.5)) return null
  const size = OUT_SIZE
  // 해 쪽 지면 방향(남 0·서 + 방위 규약: 해가 방위 A면 (−sin A, −cos A))과 1 m당 오르는 높이
  const dx = -Math.sin(sun.azimuth)
  const dy = -Math.cos(sun.azimuth)
  const rise = Math.tan(sun.altitude)
  const cosAlt = Math.cos(sun.altitude)
  const sunV = [dx * cosAlt, dy * cosAlt, Math.sin(sun.altitude)]
  const px = new Uint8ClampedArray(size * size * 4)
  for (let row = 0; row < size; row++) {
    // 그림 위쪽이 북쪽
    const y = OUT_HALF - (row + 0.5) * OUT_CELL
    for (let col = 0; col < size; col++) {
      const x = -OUT_HALF + (col + 0.5) * OUT_CELL
      const z0 = at(g, x, y)
      if (!Number.isFinite(z0)) continue
      // 비탈이 해를 등지면 자기 그림자
      const gx = (at(g, x + DEM_CELL / 2, y) - at(g, x - DEM_CELL / 2, y)) / DEM_CELL
      const gy = (at(g, x, y + DEM_CELL / 2) - at(g, x, y - DEM_CELL / 2)) / DEM_CELL
      const nl = Math.hypot(gx, gy, 1)
      const cosI = (-gx * sunV[0] - gy * sunV[1] + sunV[2]) / nl
      let shade = cosI <= 0.02
      if (!shade) {
        // 해 쪽으로 따라가며 앞 지형이 광선 위로 올라오는지
        const start = z0 + 1
        for (let r = DEM_CELL; r < MAX_REACH; r += Math.max(DEM_CELL, r * 0.02)) {
          const zr = start + r * rise
          if (zr > g.maxZ) break
          const zt = at(g, x + dx * r, y + dy * r)
          if (!Number.isFinite(zt)) break
          if (zt > zr) {
            shade = true
            break
          }
        }
      }
      if (!shade) continue
      const k = (row * size + col) * 4
      px[k] = 12
      px[k + 1] = 18
      px[k + 2] = 38
      px[k + 3] = 140
    }
  }
  return px
}

export class TerrainShader {
  private readonly grid: ShadeGrid
  private readonly dem: SiteDem
  private worker: Worker | null = null
  private seq = 0
  private readonly waiting = new Map<number, (px: Uint8ClampedArray<ArrayBuffer> | null) => void>()

  constructor(dem: SiteDem) {
    this.dem = dem
    const half = dem.radius
    const n = Math.floor((2 * half) / DEM_CELL) + 1
    const z = new Float32Array(n * n)
    let maxZ = -Infinity
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const [lon, lat] = dem.frame.toLonLat([-half + i * DEM_CELL, -half + j * DEM_CELL])
        const v = dem.elevation(lon, lat)
        const zz = Number.isFinite(v) ? v : NaN
        z[j * n + i] = zz
        if (zz > maxZ) maxZ = zz
      }
    this.grid = { z, n, half, maxZ }
  }

  /** 이 해 위치의 그림자 그림. 워커에서 그리고, 워커를 못 쓰면 이 자리에서 그린다. */
  render(sun: SunPos): Promise<TerrainShadeImage | null> {
    const pixels = this.compute(sun)
    return pixels.then((px) => (px ? this.image(px) : null))
  }

  /** 워커를 닫는다. 표고를 새로 받아 셰이더를 바꿀 때 부른다. */
  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const done of this.waiting.values()) done(null)
    this.waiting.clear()
  }

  private compute(sun: SunPos): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
    if (!this.worker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./terrainShadow.worker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = (e: MessageEvent<{ seq: number; pixels: Uint8ClampedArray<ArrayBuffer> | null }>) => {
          this.waiting.get(e.data.seq)?.(e.data.pixels)
          this.waiting.delete(e.data.seq)
        }
        this.worker.postMessage({ type: 'grid', grid: this.grid })
      } catch {
        this.worker = null
      }
    }
    if (!this.worker) return Promise.resolve(shadePixels(this.grid, sun))
    const seq = ++this.seq
    this.worker.postMessage({ type: 'render', seq, sun })
    return new Promise((resolve) => this.waiting.set(seq, resolve))
  }

  private image(px: Uint8ClampedArray<ArrayBuffer>): TerrainShadeImage {
    const canvas = document.createElement('canvas')
    canvas.width = OUT_SIZE
    canvas.height = OUT_SIZE
    canvas.getContext('2d')!.putImageData(new ImageData(px, OUT_SIZE, OUT_SIZE), 0, 0)
    const corner = (x: number, y: number) => this.dem.frame.toLonLat([x, y]) as [number, number]
    return {
      canvas,
      coordinates: [corner(-OUT_HALF, OUT_HALF), corner(OUT_HALF, OUT_HALF), corner(OUT_HALF, -OUT_HALF), corner(-OUT_HALF, -OUT_HALF)],
    }
  }
}
