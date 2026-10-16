import { evaluateTask, type Evaluated, type OptimizeInput, type Task } from './optimize'

// 후보 배치 묶음을 받아 하나씩 평가한다. 여러 워커가 나눠 맡는다(optimizePool).
self.onmessage = (e: MessageEvent<{ input: OptimizeInput; tasks: Task[]; quick: boolean }>) => {
  try {
    const { input, tasks, quick } = e.data
    const out: Evaluated[] = []
    for (const t of tasks) {
      const c = evaluateTask(input, t, quick)
      if (c) out.push(c)
      self.postMessage({ type: 'progress' })
    }
    self.postMessage({ type: 'done', results: out })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message })
  }
}
