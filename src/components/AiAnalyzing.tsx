import { useEffect, useState } from 'react'

interface Props {
  /** 분석을 시작한 시각(performance.now()) */
  startedAt: number
  /** 이 시간(ms) 동안 분석 화면을 보여 준다 */
  duration: number
  /** 실제 계산이 끝났는지. 시간이 다 되어도 덜 끝났으면 99%에서 기다린다. */
  finished: boolean
  onCancel: () => void
}

const STAGES = [
  '부지 경계와 지형을 읽고 있어요',
  '경사각·방위각 조합을 만들고 있어요',
  '열 간격과 첫 열 위치를 맞춰 보고 있어요',
  '계절별 음영과 발전량을 계산하고 있어요',
  '설치비와 LCOE를 비교하고 있어요',
  '가장 좋은 배치를 고르고 있어요',
]

// 모션 그래픽에 깔리는 모듈 세트 격자(열 × 칸)
const ROWS = 5
const COLS = 7

/** AI 설계가 도는 동안 지도 위에 띄우는 분석 화면 */
export default function AiAnalyzing(props: Props) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(id)
  }, [])
  const timeShare = Math.min(1, (now - props.startedAt) / props.duration)
  const pct = props.finished ? timeShare : Math.min(timeShare, 0.99)
  const stage = Math.min(STAGES.length - 1, Math.floor(timeShare * STAGES.length))

  return (
    <div className="ai-overlay" role="status" aria-live="polite">
      <div className="ai-card">
        <svg className="ai-art" viewBox="0 0 240 160" aria-hidden="true">
          <defs>
            <linearGradient id="ai-scan" x1="0" x2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
              <stop offset="0.8" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0.9" />
            </linearGradient>
            <clipPath id="ai-site">
              <path d="M28 34 L196 22 L214 132 L40 142 Z" />
            </clipPath>
          </defs>
          <g className="ai-sun">
            <circle cx="210" cy="22" r="9" />
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1="210" y1="6" x2="210" y2="2" transform={`rotate(${i * 45} 210 22)`} />
            ))}
          </g>
          <path className="ai-site" d="M28 34 L196 22 L214 132 L40 142 Z" />
          <g clipPath="url(#ai-site)">
            {Array.from({ length: ROWS }, (_, r) =>
              Array.from({ length: COLS }, (_, c) => (
                <rect
                  key={`${r}-${c}`}
                  className="ai-module"
                  x={40 + c * 24}
                  y={38 + r * 20}
                  width={21}
                  height={11}
                  rx={1}
                  style={{ animationDelay: `${(r * COLS + c) * 0.06}s` }}
                />
              )),
            )}
            <rect className="ai-scanline" x="-60" y="0" width="60" height="160" fill="url(#ai-scan)" />
          </g>
          <circle className="ai-pulse" cx="120" cy="82" r="10" />
        </svg>

        <h2 className="ai-title">
          AI가 최적의 배치를 분석하고 있어요
          <span className="ai-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </h2>
        <p className="ai-stage" key={stage}>
          {STAGES[stage]}
        </p>
        <div className="ai-progress" aria-label={`${Math.round(pct * 100)}%`}>
          <div style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="ai-foot">
          <span>{Math.round(pct * 100)}%</span>
          <button type="button" className="ghost" onClick={props.onCancel}>
            중단
          </button>
        </div>
      </div>
    </div>
  )
}
