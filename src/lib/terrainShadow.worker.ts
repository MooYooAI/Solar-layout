import { shadePixels, type ShadeGrid } from './terrainShadow'
import type { SunPos } from './sun'

// 지형 그림자 그림을 메인 화면 밖에서 그린다. 표고 격자는 처음에 한 번 받아 둔다.
let grid: ShadeGrid | null = null

self.onmessage = (e: MessageEvent<{ type: 'grid'; grid: ShadeGrid } | { type: 'render'; seq: number; sun: SunPos }>) => {
  const m = e.data
  if (m.type === 'grid') {
    grid = m.grid
    return
  }
  const pixels = grid ? shadePixels(grid, m.sun) : null
  self.postMessage({ seq: m.seq, pixels }, pixels ? { transfer: [pixels.buffer] } : undefined)
}
