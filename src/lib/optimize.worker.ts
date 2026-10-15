import { optimize, type OptimizeInput } from './optimize'

self.onmessage = (e: MessageEvent<OptimizeInput>) => {
  try {
    const results = optimize(e.data, (done, total, phase) => self.postMessage({ type: 'progress', done, total, phase }))
    self.postMessage({ type: 'done', results })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message })
  }
}
