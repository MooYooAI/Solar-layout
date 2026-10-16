import { evaluateDesign, type DesignInput } from './design'

/** 실시간 지표에서 그늘을 잴 세트 수 상한. 넘으면 고르게 뽑는다. */
const LIVE_SHADE_SETS = 250

// 현재 배치의 실시간 지표. 편집할 때마다 메인 화면이 멈추지 않게 워커에서 계산한다.
self.onmessage = (e: MessageEvent<{ seq: number; input: DesignInput }>) => {
  try {
    self.postMessage({ type: 'done', seq: e.data.seq, result: evaluateDesign(e.data.input, { maxShadeSets: LIVE_SHADE_SETS }) })
  } catch (err) {
    self.postMessage({ type: 'error', seq: e.data.seq, message: (err as Error).message })
  }
}
