// 산·언덕이 땅에 드리우는 그림자 지도. 부지 주변 표고를 격자로 깔아 두고, 칸마다 해 쪽으로 광선을 따라가
// 앞을 막는 지형이 있는지(드리운 그림자), 칸의 비탈이 해를 등지는지(자기 그림자)를 본다.
// 결과는 반투명 그림으로 만들어 3D 지형 위에 덮는다. 표고 해상도(약 30 m)만큼 거친 그림자다.

import { deg2rad } from './geo'
import type { SiteDem } from './horizon'
import type { SunPos } from './sun'

/** 지도에 덮을 그림(캔버스, 위가 북)과 네 모서리(경위도: 왼위, 오른위, 오른아래, 왼아래) */
export interface TerrainShadeImage {
  canvas: HTMLCanvasElement
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
}

/** 표고 격자 간격(m). 원자료 해상도와 비슷하게 둔다. */
const DEM_CELL = 30
/** 그림자 지도 칸(m)과 반폭(m) */
const OUT_CELL = 8
const OUT_HALF = 1500
/** 광선이 이 거리(m)를 넘으면 그만 본다 */
const MAX_REACH = 6000

export class TerrainShader {
  private readonly n: number
  private readonly half: number
  private readonly z: Float32Array
  private readonly maxZ: number
  private readonly dem: SiteDem

  constructor(dem: SiteDem) {
    this.dem = dem
    this.half = dem.radius
    this.n = Math.floor((2 * dem.radius) / DEM_CELL) + 1
    this.z = new Float32Array(this.n * this.n)
    let maxZ = -Infinity
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const [lon, lat] = dem.frame.toLonLat([-this.half + i * DEM_CELL, -this.half + j * DEM_CELL])
        const v = dem.elevation(lon, lat)
        const z = Number.isFinite(v) ? v : NaN
        this.z[j * this.n + i] = z
        if (z > maxZ) maxZ = z
      }
    this.maxZ = maxZ
  }

  /** 부지 중심 기준 로컬 (x, y) m의 표고(쌍선형). 격자 밖은 NaN */
  private at(x: number, y: number): number {
    const fx = (x + this.half) / DEM_CELL
    const fy = (y + this.half) / DEM_CELL
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    if (i < 0 || j < 0 || i >= this.n - 1 || j >= this.n - 1) return NaN
    const tx = fx - i
    const ty = fy - j
    const k = j * this.n + i
    const z = this.z
    return z[k] * (1 - tx) * (1 - ty) + z[k + 1] * tx * (1 - ty) + z[k + this.n] * (1 - tx) * ty + z[k + this.n + 1] * tx * ty
  }

  /** 이 해 위치에서 그늘진 칸을 칠한 그림. 해가 지평선 아래면 null. */
  render(sun: SunPos): TerrainShadeImage | null {
    if (sun.altitude <= deg2rad(0.5)) return null
    const size = Math.round((2 * OUT_HALF) / OUT_CELL)
    // 해 쪽 지면 방향(남 0·서 + 방위 규약: 해가 방위 A면 (−sin A, −cos A))과 1 m당 오르는 높이
    const dx = -Math.sin(sun.azimuth)
    const dy = -Math.cos(sun.azimuth)
    const rise = Math.tan(sun.altitude)
    const cosAlt = Math.cos(sun.altitude)
    const sunV = [dx * cosAlt, dy * cosAlt, Math.sin(sun.altitude)]
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(size, size)
    for (let row = 0; row < size; row++) {
      // 그림 위쪽이 북쪽
      const y = OUT_HALF - (row + 0.5) * OUT_CELL
      for (let col = 0; col < size; col++) {
        const x = -OUT_HALF + (col + 0.5) * OUT_CELL
        const z0 = this.at(x, y)
        if (!Number.isFinite(z0)) continue
        // 비탈이 해를 등지면 자기 그림자
        const gx = (this.at(x + DEM_CELL / 2, y) - this.at(x - DEM_CELL / 2, y)) / DEM_CELL
        const gy = (this.at(x, y + DEM_CELL / 2) - this.at(x, y - DEM_CELL / 2)) / DEM_CELL
        const nl = Math.hypot(gx, gy, 1)
        const cosI = (-gx * sunV[0] - gy * sunV[1] + sunV[2]) / nl
        let shade = cosI <= 0.02
        if (!shade) {
          // 해 쪽으로 따라가며 앞 지형이 광선 위로 올라오는지
          const start = z0 + 1
          for (let r = DEM_CELL; r < MAX_REACH; r += Math.max(DEM_CELL, r * 0.02)) {
            const zr = start + r * rise
            if (zr > this.maxZ) break
            const zt = this.at(x + dx * r, y + dy * r)
            if (!Number.isFinite(zt)) break
            if (zt > zr) {
              shade = true
              break
            }
          }
        }
        if (!shade) continue
        const k = (row * size + col) * 4
        img.data[k] = 12
        img.data[k + 1] = 18
        img.data[k + 2] = 38
        img.data[k + 3] = 140
      }
    }
    ctx.putImageData(img, 0, 0)
    const corner = (x: number, y: number) => this.dem.frame.toLonLat([x, y]) as [number, number]
    return {
      canvas,
      coordinates: [corner(-OUT_HALF, OUT_HALF), corner(OUT_HALF, OUT_HALF), corner(OUT_HALF, -OUT_HALF), corner(-OUT_HALF, -OUT_HALF)],
    }
  }
}
