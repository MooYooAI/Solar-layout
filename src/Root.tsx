import { lazy, Suspense, useEffect, useState } from 'react'
import Landing from './components/Landing'

// 설계 화면은 무거우니 랜딩에서 들어갈 때 읽는다.
const App = lazy(() => import('./App.tsx'))

/** 주소가 #app이면 설계 화면, 아니면 랜딩. 뒤로 가기로 랜딩에 돌아올 수 있다. */
export default function Root() {
  const [inApp, setInApp] = useState(() => location.hash === '#app')
  useEffect(() => {
    const onHash = () => setInApp(location.hash === '#app')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // 랜딩이 보이는 동안 설계 화면 코드를 미리 받아 둔다.
  useEffect(() => {
    if (!inApp) void import('./App.tsx')
  }, [inApp])
  if (!inApp)
    return (
      <Landing
        onStart={() => {
          location.hash = 'app'
          window.scrollTo(0, 0)
        }}
      />
    )
  return (
    <Suspense fallback={<div className="app-loading">설계 화면을 여는 중…</div>}>
      <App />
    </Suspense>
  )
}
