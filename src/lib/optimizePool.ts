// AI 설계를 여러 웹 워커에 나눠 돌린다. 1차 훑기 후보와 2차 정밀 계산 후보를 워커 수만큼 쪼개 동시에 평가한다.

import { pickCandidates, planCoarse, planRefine, type Candidate, type Evaluated, type OptimizeInput, type Task } from './optimize'

export interface OptimizeRun {
  promise: Promise<Candidate[]>
  cancel: () => void
}

export function runOptimizePool(
  input: OptimizeInput,
  onProgress: (done: number, total: number, phase: string) => void,
): OptimizeRun {
  const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  const workers = Array.from({ length: n }, () => new Worker(new URL('./optimize.worker.ts', import.meta.url), { type: 'module' }))
  let cancelled = false
  const cancel = () => {
    cancelled = true
    workers.forEach((w) => w.terminate())
  }

  const runPhase = (tasks: Task[], quick: boolean, phase: string) =>
    new Promise<Evaluated[]>((resolve, reject) => {
      // 비싼 후보가 한 워커에 몰리지 않게 번갈아 나눈다.
      const chunks: Task[][] = workers.map(() => [])
      tasks.forEach((t, i) => chunks[i % workers.length].push(t))
      let done = 0
      let finished = 0
      const results: Evaluated[] = []
      onProgress(0, tasks.length, phase)
      workers.forEach((w, i) => {
        w.onmessage = (e) => {
          const m = e.data
          if (m.type === 'progress') onProgress(++done, tasks.length, phase)
          else if (m.type === 'done') {
            results.push(...m.results)
            if (++finished === workers.length) resolve(results)
          } else reject(new Error(m.message))
        }
        w.onerror = (e) => reject(new Error(e.message || '계산 중 오류가 났습니다.'))
        w.postMessage({ input, tasks: chunks[i], quick })
      })
    })

  const promise = (async () => {
    try {
      const coarse = await runPhase(planCoarse(input), true, '후보 훑는 중')
      if (cancelled) return []
      const fine = await runPhase(planRefine(coarse), false, '상위 후보 정밀 계산 중')
      return pickCandidates(fine)
    } finally {
      workers.forEach((w) => w.terminate())
    }
  })()
  return { promise, cancel }
}
