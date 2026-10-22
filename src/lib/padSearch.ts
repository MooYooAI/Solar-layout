// 전기실 최적 자리: 경계 둘레 후보마다 그 자리를 비우고 다시 배치해, 잃는 모듈·케이블 길이와 손실·그림자를
// 모두 넣은 사업 순현재가치(NPV)가 가장 큰 자리를 고른다.

import { evaluateDesign, type DesignInput } from './design'
import { autoLayout, type LayoutParams } from './layout'
import { zonedLayout, type ZoneMode } from './zones'
import type { BuildMask } from './buildable'
import type { EquipPad } from './equipment'

export interface PadSearchInput extends Omit<DesignInput, 'sets' | 'switchboard'> {
  params: LayoutParams
  /** 'grid'면 한 방향 배치, 아니면 구역별 배치 방식 */
  layoutMode: ZoneMode | 'grid'
  mask: BuildMask | null
  /** 사용자 장애물 바닥(전기실 제외) */
  keepOut: number[][][]
}

export interface PadScore {
  pad: EquipPad
  modules: number
  kWp: number
  annualKWh: number
  npv: number
  /** 직류+교류 케이블 손실(%) */
  cableLossPct: number
}

/** 그늘을 잴 세트 수 상한. 후보끼리 견주는 데는 이 정도로 충분하다. */
const SHADE_SETS = 150

export function scorePad(i: PadSearchInput, pad: EquipPad): PadScore {
  const keepOut = [...i.keepOut, pad.keepOut]
  const p = i.params
  const sets =
    (i.layoutMode === 'grid' ? null : zonedLayout(i.parcel, p, { mode: i.layoutMode, mask: i.mask, keepOut })) ?? autoLayout(i.parcel, p, 0, i.mask, keepOut)
  const r = evaluateDesign(
    {
      ...i,
      sets,
      obstacles: [...i.obstacles, { id: 'equip-pad', name: pad.label, ring: pad.ring, height: pad.height }],
      switchboard: pad.center,
    },
    { shade: 'medium', maxShadeSets: SHADE_SETS },
  )
  return {
    pad,
    modules: r.metrics.modules,
    kWp: r.metrics.kWp,
    annualKWh: r.metrics.annualKWh,
    npv: r.metrics.npv,
    cableLossPct: r.elec ? r.elec.dcLossPct + r.elec.acLossPct : 0,
  }
}

/** 후보를 워커 여러 개에 나눠 평가하고 NPV가 큰 순서로 돌려준다. */
export function runPadSearch(input: PadSearchInput, pads: EquipPad[], onProgress?: (done: number, total: number) => void): Promise<PadScore[]> {
  const n = Math.max(1, Math.min(pads.length, 6, (navigator.hardwareConcurrency || 4) - 1))
  const workers = Array.from({ length: n }, () => new Worker(new URL('./pad.worker.ts', import.meta.url), { type: 'module' }))
  const chunks: EquipPad[][] = workers.map(() => [])
  pads.forEach((p, k) => chunks[k % n].push(p))
  let done = 0
  let finished = 0
  const results: PadScore[] = []
  return new Promise<PadScore[]>((resolve, reject) => {
    workers.forEach((w, k) => {
      w.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress') onProgress?.(++done, pads.length)
        else if (m.type === 'done') {
          results.push(...m.results)
          if (++finished === n) resolve(results.sort((a, b) => b.npv - a.npv))
        } else reject(new Error(m.message))
      }
      w.onerror = (e) => reject(new Error(e.message || '계산 중 오류가 났습니다.'))
      w.postMessage({ input, pads: chunks[k] })
    })
  }).finally(() => workers.forEach((w) => w.terminate()))
}
