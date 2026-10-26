import { useEffect, useRef } from 'react'
import '../landing.css'
import designShot from '../assets/screens/design.jpg'
import editShot from '../assets/screens/edit.jpg'
import shadeShot from '../assets/screens/shade.jpg'

interface Props {
  onStart: () => void
}

const FEATURES: Array<{ title: string; body: string }> = [
  { title: '지번 검색과 지적도', body: '지번만 넣으면 연속지적도 경계와 지목·면적·용도지역·공시지가를 바로 불러옵니다. 옆 지번을 더해 한 부지로 묶을 수도 있습니다.' },
  { title: 'AI 설계', body: '경사각·방위각·열 간격을 바꿔 수십 가지 배치를 만들고 발전량·설치비·LCOE로 비교해 최적안을 고릅니다.' },
  { title: '계절별 음영 분석', body: '한국 위도의 태양 궤적과 주변 산 지평선으로 동지·하지·시간대별 그림자와 하루 음영 손실을 계산합니다.' },
  { title: '간격과 이격 자유 설정', body: '모듈 패널 간격, 세트 간 간격, 앞뒤 열 이격거리와 경계 이격을 mm·m 단위로 정하고 바로 다시 배치합니다.' },
  { title: '수동 편집', body: '배치 편집 화면에서 세트를 끌어 옮기고, 회전·복제·영역 선택·미세 이동으로 현장에 맞게 다듬습니다.' },
  { title: '발전량, 도면, 보고서', body: '월별 발전량과 회수기간·IRR, 단선결선도와 DXF 배치도, 인쇄용 보고서까지 한 번에 받습니다.' },
]

const STEPS = ['지번 검색', '지형 확인', 'AI 설계', '음영·발전량', '경제성·도면']

const FIGURES: Array<[string, string]> = [
  ['5분', '부지 하나 검토 시간'],
  ['수십 가지', 'AI가 비교하는 배치안'],
  ['12개월', '계절별 음영 시뮬레이션'],
  ['1클릭', '도면·보고서 내보내기'],
]

const SOURCES = ['VWorld 연속지적도', '한국 기상 권역별 일사량', 'DXF, CSV, 보고서']

// ── 히어로 측량도: 등고선은 캔버스에 생성하고, 필지·모듈 열·치수는 SVG로 얹는다 ──
const W = 760
const H = 600
const PARCEL: Array<[number, number]> = [
  [170, 140],
  [590, 104],
  [628, 440],
  [196, 474],
]
const CX = PARCEL.reduce((s, p) => s + p[0], 0) / 4
const CY = PARCEL.reduce((s, p) => s + p[1], 0) / 4
const inset = (k: number) => PARCEL.map(([x, y]) => [CX + (x - CX) * k, CY + (y - CY) * k] as const)
const toPath = (pts: ReadonlyArray<readonly [number, number]>) => 'M' + pts.map((p) => p.join(' ')).join(' L') + ' Z'
const TILT = (Math.atan2(PARCEL[1][1] - PARCEL[0][1], PARCEL[1][0] - PARCEL[0][0]) * 180) / Math.PI

/** 0~1 값 잡음. 같은 씨앗이면 같은 땅이 나온다. */
function noise2(seed: number) {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453
    return s - Math.floor(s)
  }
  const sm = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number) => {
    const i = Math.floor(x)
    const j = Math.floor(y)
    const u = sm(x - i)
    const v = sm(y - j)
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u
    const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u
    return a + (b - a) * v
  }
}

function drawSurvey(canvas: HTMLCanvasElement) {
  const box = canvas.getBoundingClientRect()
  if (!box.width || !box.height) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(box.width * dpr)
  canvas.height = Math.round(box.height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const css = getComputedStyle(canvas)
  const contour = css.getPropertyValue('--color-contour').trim()
  const ink = css.getPropertyValue('--color-ink').trim()
  const light = css.getPropertyValue('--color-paper-2').trim()

  const n = noise2(7)
  const w = box.width
  const h = box.height
  // 오른쪽 위가 산, 왼쪽 아래가 물길 쪽으로 낮아지는 땅
  const height = (x: number, y: number) => {
    const fx = x / 120
    const fy = y / 120
    return 0.55 * n(fx, fy) + 0.28 * n(fx * 2.1 + 3, fy * 2.1 + 9) + 0.12 * n(fx * 4.3, fy * 4.3) + 0.9 * (x / w - y / h)
  }
  const step = 6
  const cols = Math.ceil(w / step) + 1
  const rows = Math.ceil(h / step) + 1
  const g = new Float32Array(cols * rows)
  let lo = Infinity
  let hi = -Infinity
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const v = height(i * step, j * step)
      g[j * cols + i] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  const levels = 30
  for (let k = 1; k < levels; k++) {
    const t = lo + ((hi - lo) * k) / levels
    ctx.beginPath()
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = g[j * cols + i]
        const b = g[j * cols + i + 1]
        const c = g[(j + 1) * cols + i + 1]
        const d = g[(j + 1) * cols + i]
        const idx = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0)
        if (idx === 0 || idx === 15) continue
        const x = i * step
        const y = j * step
        const top: [number, number] = [x + (step * (t - a)) / (b - a), y]
        const right: [number, number] = [x + step, y + (step * (t - b)) / (c - b)]
        const bottom: [number, number] = [x + (step * (t - d)) / (c - d), y + step]
        const left: [number, number] = [x, y + (step * (t - a)) / (d - a)]
        const seg = (p: [number, number], q: [number, number]) => {
          ctx.moveTo(p[0], p[1])
          ctx.lineTo(q[0], q[1])
        }
        switch (idx) {
          case 1: case 14: seg(left, bottom); break
          case 2: case 13: seg(bottom, right); break
          case 3: case 12: seg(left, right); break
          case 4: case 11: seg(top, right); break
          case 6: case 9: seg(top, bottom); break
          case 7: case 8: seg(left, top); break
          case 5: seg(left, top); seg(bottom, right); break
          case 10: seg(top, right); seg(left, bottom); break
        }
      }
    ctx.strokeStyle = contour
    ctx.globalAlpha = k % 5 === 0 ? 0.75 : 0.42
    ctx.lineWidth = k % 5 === 0 ? 1.1 : 0.6
    ctx.stroke()
  }
  // 종이 결: 지도 안에만
  ctx.globalAlpha = 0.05
  ctx.fillStyle = ink
  const r = noise2(3)
  for (let s = 0; s < 2600; s++) ctx.fillRect(r(s * 0.37, 1.3) * w, r(2.1, s * 0.53) * h, 1, 1)
  // 접힌 자국 두 줄
  const crease = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = light
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    ctx.globalAlpha = 0.06
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0 + 1.5, y0 + 1.5)
    ctx.lineTo(x1 + 1.5, y1 + 1.5)
    ctx.stroke()
  }
  crease(w * 0.5, 0, w * 0.5, h)
  crease(0, h * 0.5, w, h * 0.5)
  ctx.globalAlpha = 1
}

function SurveyMap() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    drawSurvey(c)
    const ro = new ResizeObserver(() => drawSurvey(c))
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  const rows = Array.from({ length: 10 }, (_, r) => -138 + r * 30)
  const sets = Array.from({ length: 9 }, (_, i) => -214 + i * 50).filter((x) => Math.abs(x + 23) > 30)
  return (
    <div className="lp-map-wrap">
    <figure className="lp-map" aria-label="예시 필지 측량도: 경계 안에 모듈 열이 배치된 모습">
      <canvas ref={ref} className="lp-map-canvas" aria-hidden="true" />
      <svg className="lp-map-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <clipPath id="lp-inset">
            <path d={toPath(inset(0.93))} />
          </clipPath>
          <pattern id="lp-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0 V5" className="lp-hatch" />
          </pattern>
        </defs>

        {/* 물길과 농로 */}
        <path className="lp-water" d="M-10 560 C 120 520, 180 590, 300 560 S 520 520, 770 580" />
        <path className="lp-road" d="M60 -10 C 90 120, 120 260, 150 330 S 210 520, 230 610" />
        <path className="lp-road" d="M74 -10 C 104 120, 134 260, 164 330 S 224 520, 244 610" />
        <text className="lp-place" x="24" y="300">농로</text>
        <text className="lp-place" x="560" y="570">하천</text>

        {/* 이웃 필지 경계 */}
        <g className="lp-lots">
          <path d="M170 140 L150 -10 M590 104 L610 -10 M628 440 L770 430 M590 104 L770 92 M196 474 L210 610 M628 440 L650 610 M380 122 L372 -10 M410 457 L420 610" />
        </g>

        {/* 태양 궤적: 동지 */}
        <path className="lp-route" d="M120 96 Q 400 -40 690 96" />
        <circle className="lp-sun" cx="405" cy="28" r="9" />
        <g className="lp-tag" transform="translate(422 16)">
          <rect width="94" height="24" rx="3" />
          <text x="10" y="16">동지 12:00</text>
        </g>

        {/* 필지와 경계 이격선 */}
        <path className="lp-parcel-fill" d={toPath(PARCEL)} />
        <path className="lp-setback" d={toPath(inset(0.93))} />

        {/* 모듈 열: 한 줄씩 차례로 놓인다 */}
        <g clipPath="url(#lp-inset)">
          <g transform={`rotate(${TILT} ${CX} ${CY}) translate(${CX} ${CY})`}>
            {rows.map((y, r) => (
              <g key={y} className="lp-row" style={{ animationDelay: `${0.5 + r * 0.09}s` }}>
                {sets.map((x) => (
                  <g key={x}>
                    <rect className="lp-shadow" x={x + 3} y={y + 14} width="46" height="6" />
                    <rect className="lp-module" x={x} y={y} width="46" height="15" rx="1" />
                    <path className="lp-cells" d={`M${x + 11.5} ${y}v15M${x + 23} ${y}v15M${x + 34.5} ${y}v15M${x} ${y + 7.5}h46`} />
                  </g>
                ))}
              </g>
            ))}
            <rect x="-40" y="124" width="34" height="22" fill="url(#lp-hatch)" className="lp-pad" />
          </g>
        </g>
        <path className="lp-parcel" d={toPath(PARCEL)} />
        <text className="lp-place lp-place-ink" transform={`translate(200 128) rotate(${TILT})`}>예시 필지</text>

        {/* 치수선 */}
        <g className="lp-dim">
          <path d="M196 498 L628 464" />
          <path d="M196 488 v20 M628 454 v20" />
          <rect x="378" y="470" width="68" height="20" rx="2" />
          <text x="412" y="485">96.4 m</text>
        </g>
      </svg>
    </figure>

      <div className="lp-entry">
        <div className="lp-entry-head">
          <span>AI 설계안</span>
          <span>예시 부지</span>
        </div>
        <div className="lp-entry-big">
          <small>설비용량</small>
          <strong>
            998.4<span> kWp</span>
          </strong>
        </div>
        <dl className="lp-entry-cells">
          <div>
            <dt>연간 발전량</dt>
            <dd>1,312 MWh</dd>
          </div>
          <div>
            <dt>음영 손실</dt>
            <dd>2.1 %</dd>
          </div>
        </dl>
        <div className="lp-entry-foot">
          <span className="lp-chip-ok">AI 설계 완료</span>
        </div>
      </div>
    </div>
  )
}

/** 처음 들어오면 보이는 소개 화면 */
export default function Landing({ onStart }: Props) {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav-in">
          <a className="lp-brand" href="#top">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <rect x="3" y="9" width="18" height="11" rx="1.5" transform="skewX(-12) translate(2 0)" />
              <path d="M8 9v11M13 9v11M3.5 14.5h17" />
              <circle cx="18.5" cy="4.5" r="2.2" />
            </svg>
            솔라 레이아웃
          </a>
          <nav aria-label="페이지">
            <a href="#features">기능</a>
            <a href="#flow">작업 흐름</a>
          </nav>
          <button type="button" className="lp-btn" onClick={onStart}>
            설계 시작하기
          </button>
        </div>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-container lp-hero-in">
          <div className="lp-hero-copy">
            <h1>
              지번만 넣으면
              <br />
              AI가 가배치까지
            </h1>
            <p className="lp-lead">지적도부터 모듈 배치, 계절별 음영, 발전량과 경제성까지 몇 분 안에 검토합니다.</p>
            <div className="lp-actions">
              <button type="button" className="lp-btn lp-btn-primary" onClick={onStart}>
                무료로 설계 시작하기
              </button>
              <a className="lp-btn" href="#features">
                기능 둘러보기
              </a>
            </div>
            <p className="lp-terms">회원가입 없이 바로 씁니다. 작업은 브라우저에 저장됩니다.</p>
          </div>
          <SurveyMap />
        </div>
      </section>

      <section className="lp-flow" id="flow">
        <div className="lp-container">
          <div className="lp-flow-head">
            <h2>다섯 단계면 끝납니다</h2>
            <ol className="lp-steps">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          <figure className="lp-shot lp-shot-wide" data-slot data-kind="product">
            <img src={designShot} alt="기본설계 화면: AI 설계안을 적용한 모듈 배치와 설비용량·발전량 개요" width="1440" height="900" loading="lazy" />
            <figcaption>AI 설계안을 적용한 기본설계 화면. 예시로 그린 140×90 m 사각형 부지입니다.</figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-figures" aria-label="검토 속도">
        <div className="lp-container">
          <dl>
            {FIGURES.map(([n, l]) => (
              <div key={l}>
                <dd>{n}</dd>
                <dt>{l}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="lp-features" id="features">
        <div className="lp-container lp-features-in">
          <div className="lp-features-list">
            <h2>부지 검토에 필요한 것을 한 화면에</h2>
            <ul className="lp-rows">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <figure className="lp-shot lp-shot-tall" data-slot data-kind="product">
            <img src={editShot} alt="배치 편집 화면: 세트를 골라 옮기고 회전·복제하는 도구" width="1440" height="900" loading="lazy" />
            <figcaption>배치 편집. 세트를 끌어 옮기고 0.1 m 단위로 미세 이동합니다.</figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-shade">
        <div className="lp-container lp-shade-in">
          <figure className="lp-shot" data-slot data-kind="product">
            <img src={shadeShot} alt="음영 화면: 동지 정오에 그늘진 세트가 붉게 표시된 배치" width="1440" height="900" loading="lazy" />
            <figcaption>동지 12:00의 그림자. 그늘진 세트는 붉게 표시됩니다.</figcaption>
          </figure>
          <div className="lp-shade-copy">
            <h2>현장 답사 전에 먼저 확인하세요</h2>
            <p className="lp-lead">설치 가능 용량과 수익성을 책상에서 먼저 봅니다.</p>
            <ul className="lp-sources">
              {SOURCES.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-container lp-final-in">
          <h2>지금 첫 부지를 올려 보세요</h2>
          <div>
            <button type="button" className="lp-btn lp-btn-ink" onClick={onStart}>
              설계 시작하기
            </button>
            <p>회원가입 없이 바로 쓸 수 있습니다. 작업은 브라우저에 저장됩니다.</p>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-container lp-foot-in">
          <p className="lp-foot-mark">솔라 레이아웃</p>
          <p>태양광 부지 검토와 가배치 자동화 도구 (초안)</p>
          <nav aria-label="바닥글">
            <a href="#features">기능</a>
            <a href="#flow">작업 흐름</a>
          </nav>
          <small>© 솔라 레이아웃</small>
        </div>
      </footer>
    </div>
  )
}
