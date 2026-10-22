import { scorePad, type PadScore, type PadSearchInput } from './padSearch'
import type { EquipPad } from './equipment'

// 전기실 후보 자리 묶음을 평가한다. 여러 워커가 나눠 맡는다(runPadSearch).
self.onmessage = (e: MessageEvent<{ input: PadSearchInput; pads: EquipPad[] }>) => {
  try {
    const out: PadScore[] = e.data.pads.map((p) => {
      const s = scorePad(e.data.input, p)
      self.postMessage({ type: 'progress' })
      return s
    })
    self.postMessage({ type: 'done', results: out })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message })
  }
}
