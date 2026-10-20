import { useEffect, useRef, useState } from 'react'
import '../landing.css'

interface Props {
  onStart: () => void
}

const FEATURES: Array<{ icon: string; title: string; body: string }> = [
  { icon: 'search', title: '지번 검색 · 지적도', body: '지번만 넣으면 연속지적도 경계와 지목·면적·용도지역·공시지가를 바로 불러옵니다. 옆 지번을 더해 한 부지로 묶을 수도 있습니다.' },
  { icon: 'ai', title: 'AI 가배치', body: '경사각·방위각·열 간격을 바꿔 수십 가지 배치를 만들고 발전량·설치비·LCOE로 비교해 최적안을 고릅니다.' },
  { icon: 'shade', title: '계절별 음영 분석', body: '한국 위도의 태양 궤적과 주변 산 지평선으로 동지·하지·시간대별 그림자와 하루 음영 손실을 계산합니다.' },
  { icon: 'grid', title: '간격·이격 자유 설정', body: '모듈 패널 간격, 세트 간 간격, 앞뒤 열 이격거리와 경계 이격을 mm·m 단위로 정하고 바로 다시 배치합니다.' },
  { icon: 'edit', title: '수동 편집', body: '배치 편집 화면에서 세트를 끌어 옮기고, 회전·복제·영역 선택·미세 이동으로 현장에 맞게 다듬습니다.' },
  { icon: 'doc', title: '발전량 · 도면 · 보고서', body: '월별 발전량과 회수기간·IRR, 단선결선도와 DXF 배치도, 인쇄용 보고서까지 한 번에 받습니다.' },
]

const STEPS = ['지번 검색', '지형 확인', 'AI 가배치', '음영·발전량', '경제성·도면']

function Icon({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {name === 'search' && (
        <g {...p}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5 5" />
        </g>
      )}
      {name === 'ai' && (
        <g {...p}>
          <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z" />
          <path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </g>
      )}
      {name === 'shade' && (
        <g {...p}>
          <circle cx="7" cy="7" r="3" />
          <path d="M4 20l6-8h8l-6 8z" />
        </g>
      )}
      {name === 'grid' && (
        <g {...p}>
          <rect x="3" y="5" width="7" height="5" rx="1" />
          <rect x="14" y="5" width="7" height="5" rx="1" />
          <rect x="3" y="14" width="7" height="5" rx="1" />
          <rect x="14" y="14" width="7" height="5" rx="1" />
        </g>
      )}
      {name === 'edit' && (
        <g {...p}>
          <path d="M4 20l4-1 11-11-3-3L5 16z" />
          <path d="M14 7l3 3" />
        </g>
      )}
      {name === 'doc' && (
        <g {...p}>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M9 13h6M9 17h6M9 9h3" />
        </g>
      )}
    </svg>
  )
}

/** 0에서 목표값까지 세어 올라가는 숫자. 화면에 보이기 시작하면 돈다. */
function useCountUp(target: number, ms: number, delay: number) {
  const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [v, setV] = useState(still ? target : 0)
  useEffect(() => {
    if (still) return
    let raf = 0
    const t0 = performance.now() + delay
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms))
      setV(target * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, delay, still])
  return v
}

// 히어로 그림: 비스듬한 필지 안에 모듈 열이 깔린다.
const ROWS = 6
const COLS = 9
const PARCEL = 'M70 92 L452 52 L496 318 L96 352 Z'

function HeroArt() {
  const kWp = useCountUp(998.4, 2600, 1500)
  const mwh = useCountUp(1312, 2600, 1700)
  return (
    <div className="lp-art" aria-hidden="true">
      <svg viewBox="0 0 560 400">
        <defs>
          <clipPath id="lp-parcel">
            <path d={PARCEL} />
          </clipPath>
          <linearGradient id="lp-sweep" x1="0" x2="1">
            <stop offset="0" stopColor="#ff8a3d" stopOpacity="0" />
            <stop offset="1" stopColor="#ff8a3d" stopOpacity="0.55" />
          </linearGradient>
          <radialGradient id="lp-sunglow">
            <stop offset="0" stopColor="#ffb15c" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffb15c" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 지적 격자 */}
        <g className="lp-cadastre">
          {Array.from({ length: 8 }, (_, i) => (
            <path key={`v${i}`} d={`M${20 + i * 75} 10 L${50 + i * 75} 395`} style={{ animationDelay: `${i * 0.05}s` }} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <path key={`h${i}`} d={`M0 ${30 + i * 72} L560 ${-10 + i * 72}`} style={{ animationDelay: `${0.2 + i * 0.05}s` }} />
          ))}
        </g>

        {/* 태양 궤적 */}
        <path className="lp-sunpath" d="M40 120 Q280 -70 520 120" />
        <g className="lp-sun">
          <circle r="34" fill="url(#lp-sunglow)" />
          <circle r="12" className="lp-sun-core" />
          <animateMotion dur="9s" begin="0s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear" path="M40 120 Q280 -70 520 120" />
        </g>

        <path className="lp-parcel-fill" d={PARCEL} />
        <g clipPath="url(#lp-parcel)">
          {Array.from({ length: ROWS }, (_, r) => (
            <g key={r}>
              {Array.from({ length: COLS }, (_, c) => {
                const x = 92 + c * 42 + r * 3
                const y = 92 + r * 40 - c * 4.2
                const d = 1.4 + r * 0.22 + c * 0.05
                return (
                  <g key={c} className="lp-set" style={{ animationDelay: `${d}s` }}>
                    <rect className="lp-shadow" x={x + 4} y={y + 18} width="38" height="8" rx="1" style={{ animationDelay: `${d + 0.3}s` }} />
                    <rect className="lp-module" x={x} y={y} width="38" height="18" rx="1.5" />
                    <path className="lp-cells" d={`M${x + 9.5} ${y} v18 M${x + 19} ${y} v18 M${x + 28.5} ${y} v18 M${x} ${y + 9} h38`} />
                  </g>
                )
              })}
            </g>
          ))}
          <rect className="lp-scan" x="-120" y="0" width="120" height="400" fill="url(#lp-sweep)" />
        </g>
        <path className="lp-parcel" d={PARCEL} />

        {/* 치수선 */}
        <g className="lp-dim">
          <path d="M96 372 L496 338" />
          <path d="M96 364 v16 M496 330 v16" />
          <text x="300" y="376">96.4 m</text>
        </g>
      </svg>

      <div className="lp-chip lp-chip-a">
        <span>설비용량</span>
        <strong>
          {kWp.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          <small> kWp</small>
        </strong>
      </div>
      <div className="lp-chip lp-chip-b">
        <span>연간 발전량</span>
        <strong>
          {Math.round(mwh).toLocaleString('ko-KR')}
          <small> MWh</small>
        </strong>
      </div>
      <div className="lp-chip lp-chip-c">
        <i className="lp-ok" />
        AI 가배치 완료 · 음영 손실 2.1%
      </div>
    </div>
  )
}

/** 화면에 들어오면 .in 클래스를 붙여 등장 애니메이션을 시작한다. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const els = root.querySelectorAll('.lp-reveal')
    if (!('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { threshold: 0.15 },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  return ref
}

/** 처음 들어오면 보이는 소개 화면 */
export default function Landing({ onStart }: Props) {
  const ref = useReveal()
  return (
    <div className="lp" ref={ref}>
      <header className="lp-nav">
        <a className="lp-brand" href="#top">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="3" y="9" width="18" height="11" rx="1.5" transform="skewX(-12) translate(2 0)" />
            <path d="M8 9v11M13 9v11M3.5 14.5h17" />
            <circle cx="18.5" cy="4.5" r="2.2" />
          </svg>
          솔라 레이아웃
        </a>
        <nav>
          <a href="#features">기능</a>
          <a href="#flow">작업 흐름</a>
        </nav>
        <button type="button" onClick={onStart}>
          설계 시작하기
        </button>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow lp-in" style={{ animationDelay: '0.1s' }}>
            태양광 부지 검토 · 가배치 자동화
          </p>
          <h1 className="lp-in" style={{ animationDelay: '0.25s' }}>
            지번만 넣으면
            <br />
            <em>AI가 가배치까지</em>
          </h1>
          <p className="lp-lead lp-in" style={{ animationDelay: '0.45s' }}>
            지적도 확인부터 모듈 배치, 계절별 음영, 발전량과 경제성까지. 며칠 걸리던 부지 검토를 몇 분 안에 끝내세요.
          </p>
          <div className="lp-cta lp-in" style={{ animationDelay: '0.6s' }}>
            <button type="button" className="lp-primary" onClick={onStart}>
              무료로 설계 시작하기
            </button>
            <a className="lp-secondary" href="#features">
              기능 둘러보기
            </a>
          </div>
          <ul className="lp-points lp-in" style={{ animationDelay: '0.75s' }}>
            <li>VWorld 연속지적도</li>
            <li>한국 기상 권역별 일사량</li>
            <li>DXF · CSV · 보고서</li>
          </ul>
        </div>
        <HeroArt />
      </section>

      <section className="lp-strip">
        {[
          ['5분', '부지 하나 검토 시간'],
          ['수십 가지', 'AI가 비교하는 배치안'],
          ['12개월', '계절별 음영 시뮬레이션'],
          ['1클릭', '도면·보고서 내보내기'],
        ].map(([n, l], i) => (
          <div key={l} className="lp-reveal" style={{ transitionDelay: `${i * 0.08}s` }}>
            <strong>{n}</strong>
            <span>{l}</span>
          </div>
        ))}
      </section>

      <section className="lp-section" id="features">
        <h2 className="lp-reveal">부지 검토에 필요한 것을 한 화면에</h2>
        <p className="lp-sub lp-reveal">현장 답사 전에 설치 가능 용량과 수익성을 먼저 확인하세요.</p>
        <div className="lp-features">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="lp-card lp-reveal" style={{ transitionDelay: `${(i % 3) * 0.1}s` }}>
              <span className="lp-icon">
                <Icon name={f.icon} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-flow" id="flow">
        <h2 className="lp-reveal">다섯 단계면 끝납니다</h2>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s} className="lp-reveal" style={{ transitionDelay: `${i * 0.12}s` }}>
              <b>{i + 1}</b>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-final lp-reveal">
        <h2>지금 첫 부지를 올려 보세요</h2>
        <p>회원가입 없이 바로 쓸 수 있습니다. 작업은 브라우저에 저장됩니다.</p>
        <button type="button" className="lp-primary" onClick={onStart}>
          설계 시작하기
        </button>
      </section>

      <footer className="lp-foot">© 솔라 레이아웃 · 태양광 배치 설계 도구 (초안)</footer>
    </div>
  )
}
