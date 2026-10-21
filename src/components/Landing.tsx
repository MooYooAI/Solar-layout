import { useEffect, useMemo, useRef, useState } from 'react'
import { LANDING_JIBUN_KEY } from '../lib/landing'
import { DAY_OF_YEAR, declination, rowSpacingForNoShade, sunPosition, sunriseSunsetSolar } from '../lib/sun'
import '../landing.css'

interface Props {
  onStart: () => void
}

/* ── 예시 부지: 앱과 같은 태양 위치 식으로 동지 하루의 그림자를 계산한다 ── */

/** 예시 부지 위도(전남 해남 부근) */
const LAT = 34.6
const DEC = declination(DAY_OF_YEAR.winterSolstice)
const SUN_TIMES = sunriseSunsetSolar(LAT, DEC) ?? { rise: 7.1, set: 16.9 }
/** 세트 경사면 길이 4.6 m, 경사 30°: 뒤 끝이 앞 끝보다 2.3 m 높고 바닥 깊이는 약 4 m */
const SET_RISE = 2.3
const SET_DEPTH = 4
const SET_WIDTH = 11.5
const SET_GAP = 0.5
/** 앱과 같은 기준: 동지 9~15시(태양시)에 앞 열 그림자가 닿지 않는 열 이격거리 */
const ROW_SPACING = rowSpacingForNoShade(LAT, SET_RISE)
const SETBACK = 3

/** 필지 경계(m, x 동쪽, y 북쪽) */
const PARCEL: Array<[number, number]> = [
  [4, 6],
  [124, 0],
  [130, 60],
  [98, 88],
  [8, 84],
]

/** 남쪽을 바라볼 때 보이는 주변 능선: [방위각(남 0, 서 +), 고도각] 도 */
const RIDGE: Array<[number, number]> = [
  [-70, 1.5],
  [-48, 3.2],
  [-30, 2],
  [-8, 3],
  [12, 2.4],
  [28, 4.5],
  [38, 8.5],
  [48, 12],
  [58, 13.5],
  [70, 9],
]

type Pt = [number, number]

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function ridgeAt(azDeg: number): number {
  if (azDeg <= RIDGE[0][0]) return RIDGE[0][1]
  for (let i = 1; i < RIDGE.length; i++) {
    const [a1, h1] = RIDGE[i]
    const [a0, h0] = RIDGE[i - 1]
    if (azDeg <= a1) return h0 + ((h1 - h0) * (azDeg - a0)) / (a1 - a0)
  }
  return RIDGE[RIDGE.length - 1][1]
}

interface SetBox {
  x: number
  y: number
}

/** 경계에서 이격을 두고, 남향 세트를 동지 무음영 피치로 채운다 */
function layoutSets(): SetBox[] {
  const sets: SetBox[] = []
  const pitch = SET_DEPTH + ROW_SPACING
  for (let y = 4; y + SET_DEPTH < 90; y += pitch) {
    for (let x = 2; x + SET_WIDTH < 132; x += SET_WIDTH + SET_GAP) {
      const corners: Pt[] = [
        [x - SETBACK, y - SETBACK],
        [x + SET_WIDTH + SETBACK, y - SETBACK],
        [x + SET_WIDTH + SETBACK, y + SET_DEPTH + SETBACK],
        [x - SETBACK, y + SET_DEPTH + SETBACK],
      ]
      if (corners.every((c) => inside(c, PARCEL))) sets.push({ x, y })
    }
  }
  return sets
}

const SETS = layoutSets()

interface SunState {
  alt: number
  az: number
  /** 해가 지평선이나 능선 아래에 있다 */
  hidden: boolean
  shadowLen: number
  shadows: Pt[][]
  /** 앞 열 그림자에 가린 모듈 면적 비율(0~1) */
  shaded: number
}

function sunAt(hour: number): SunState {
  const { altitude, azimuth } = sunPosition(LAT, DEC, hour)
  const alt = (altitude * 180) / Math.PI
  const az = (azimuth * 180) / Math.PI
  const hidden = alt <= ridgeAt(az)
  if (alt <= 0.5) return { alt, az, hidden: true, shadowLen: Infinity, shadows: [], shaded: 1 }
  const shadowLen = SET_RISE / Math.tan(altitude)
  const len = Math.min(shadowLen, 80)
  const dx = Math.sin(azimuth) * len
  const dy = Math.cos(azimuth) * len
  // 세트 뒤 끝(높은 쪽) 모서리가 땅에 드리우는 평행사변형
  const shadows: Pt[][] = SETS.map(({ x, y }) => [
    [x, y + SET_DEPTH],
    [x + SET_WIDTH, y + SET_DEPTH],
    [x + SET_WIDTH + dx, y + SET_DEPTH + dy],
    [x + dx, y + SET_DEPTH + dy],
  ])
  let hit = 0
  let total = 0
  SETS.forEach(({ x, y }, si) => {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const p: Pt = [x + ((i + 0.5) * SET_WIDTH) / 6, y + ((j + 0.5) * SET_DEPTH) / 3]
        total++
        if (shadows.some((s, k) => k !== si && inside(p, s))) hit++
      }
    }
  })
  return { alt, az, hidden, shadowLen, shadows, shaded: hidden ? 1 : hit / total }
}

/* ── 스크롤 단계: 시각(태양시)마다 기능 하나 ── */

interface Beat {
  id: string
  hour: number
  title: string
  body: string
}

const BEATS: Beat[] = [
  {
    id: 'parcel',
    hour: SUN_TIMES.rise + 0.15,
    title: '해 뜰 무렵, 지번 하나로 필지부터',
    body: 'VWorld 연속지적도로 경계와 지목·면적·용도지역·공시지가를 불러옵니다. 옆 지번을 더해 한 부지로 묶고, 키가 없으면 영역을 직접 그립니다.',
  },
  {
    id: 'spacing',
    hour: 9,
    title: '9시, 그림자가 가장 길게 눕는 때',
    body: `동지 9~15시에 앞 열 그림자가 뒷 열에 닿지 않는 열 이격거리를 계산해 바로 추천합니다. 이 예시 부지에서는 ${ROW_SPACING.toFixed(1)} m입니다. 패널·세트 간격과 경계 이격도 직접 넣습니다.`,
  },
  {
    id: 'ai',
    hour: 12,
    title: '남중, AI가 배치안을 비교합니다',
    body: '경사각·방위각·피치·첫 열 위치를 바꾼 수십 가지 배치를 전기 설계, 음영·클리핑·케이블 손실, 토공량, 설치비까지 계산해 LCOE와 IRR로 나란히 놓습니다.',
  },
  {
    id: 'edit',
    hour: 14,
    title: '오후, 마지막은 손으로 다듬습니다',
    body: '세트를 끌어 옮기고 회전·복제·영역 선택을 하고, 0.1 m 단위로 미세 이동합니다. 되돌리기와 타임라인으로 언제든 이전 안으로 돌아갑니다.',
  },
  {
    id: 'horizon',
    hour: 15.75,
    title: '해가 산을 넘으면 부지 전체가 그늘',
    body: '반경 5 km 지형으로 남쪽 지평선을 그려, 해가 주변 산 뒤로 넘어가는 시각을 찾고 하루 음영 손실을 발전량에 반영합니다.',
  },
  {
    id: 'drawings',
    hour: SUN_TIMES.set - 0.05,
    title: '해가 지면, 도면과 보고서',
    body: '표지부터 공사계획 평면도, 단선결선도, 절·성토 평면도까지 15종을 DXF·SVG·PDF로 받고, 입지검토 보고서로 인쇄합니다.',
  },
]

const IMG_BASE = `${import.meta.env.BASE_URL}landing/`

/** 지번 입력 + 시작 버튼. 넣은 지번은 설계 화면 검색 칸에 미리 채워진다. */
function JibunForm({ onStart, id }: { onStart: () => void; id: string }) {
  const [jibun, setJibun] = useState('')
  return (
    <form
      className="lp-jibun"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          if (jibun.trim()) sessionStorage.setItem(LANDING_JIBUN_KEY, jibun.trim())
        } catch {
          // 저장소를 못 쓰면 빈 검색 칸으로 연다
        }
        onStart()
      }}
    >
      <label htmlFor={id} className="lp-sr">
        지번
      </label>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5 5" />
      </svg>
      <input id={id} value={jibun} onChange={(e) => setJibun(e.target.value)} placeholder="예: 전라남도 해남군 산이면 구성리 100" autoComplete="off" />
      <button type="submit">설계 시작</button>
    </form>
  )
}

/** 스크롤 위치로 시각을 정한다: 기준선을 지난 단계 사이를 이어서 보간한다. */
function useDayClock() {
  const refs = useRef<Array<HTMLElement | null>>([])
  const [state, setState] = useState({ hour: BEATS[0].hour, active: 0 })
  useEffect(() => {
    let raf = 0
    const narrow = window.matchMedia('(max-width: 900px)')
    const pick = () => {
      raf = 0
      const line = window.innerHeight * (narrow.matches ? 0.82 : 0.6)
      const tops = refs.current.map((el) => (el ? el.getBoundingClientRect().top : Infinity))
      let i = -1
      tops.forEach((t, k) => {
        if (t < line) i = k
      })
      if (i < 0) return setState({ hour: BEATS[0].hour, active: 0 })
      if (i === BEATS.length - 1) return setState({ hour: BEATS[i].hour, active: i })
      const f = Math.min(1, Math.max(0, (line - tops[i]) / (tops[i + 1] - tops[i])))
      setState({ hour: BEATS[i].hour + (BEATS[i + 1].hour - BEATS[i].hour) * f, active: i })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(pick)
    }
    pick()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])
  return { refs, ...state }
}

const fmtClock = (h: number) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const dirName = (az: number) => (Math.abs(az) < 7 ? '정남' : `${az < 0 ? '남동' : '남서'} ${Math.abs(az).toFixed(0)}°`)

/* 하늘 띠: 남쪽을 바라본 모습. x = 방위각(동 왼쪽, 서 오른쪽), y = 고도각 */
const SKY_W = 600
const SKY_H = 152
const HORIZON_Y = 128
const AZ_SPAN = 70
const skyX = (az: number) => ((az + AZ_SPAN) / (2 * AZ_SPAN)) * SKY_W
const skyY = (alt: number) => HORIZON_Y - alt * 3.4

const SUN_PATH = (() => {
  const pts: string[] = []
  for (let h = SUN_TIMES.rise - 0.1; h <= SUN_TIMES.set + 0.1; h += 0.1) {
    const { altitude, azimuth } = sunPosition(LAT, DEC, h)
    pts.push(`${skyX((azimuth * 180) / Math.PI).toFixed(1)},${skyY((altitude * 180) / Math.PI).toFixed(1)}`)
  }
  return `M${pts.join('L')}`
})()

const RIDGE_PATH = `M0,${HORIZON_Y}${RIDGE.map(([a, h]) => `L${skyX(a).toFixed(1)},${skyY(h).toFixed(1)}`).join('')}L${SKY_W},${HORIZON_Y}Z`

/* 배치도: m 단위, 북쪽이 위 */
const PLAN_H = 92
const toSvg = ([x, y]: Pt) => `${x.toFixed(2)},${(PLAN_H - y).toFixed(2)}`
const PARCEL_PTS = PARCEL.map(toSvg).join(' ')

function DayStage({ hour }: { hour: number }) {
  const sun = useMemo(() => sunAt(hour), [hour])
  const up = sun.alt > 0
  // 고도가 높을수록 하늘 띠가 밝아지고, 해가 낮을 때는 지평선 쪽에 노을빛이 돈다
  const light = Math.max(0, Math.min(1, sun.alt / 30))
  const glow = up ? 1 - light : 0.4
  const sky = `linear-gradient(oklch(${(22 + light * 16).toFixed(1)}% 0.045 250), oklch(${(26 + light * 14).toFixed(1)}% ${(0.03 + glow * 0.07).toFixed(3)} ${(250 - glow * 205).toFixed(0)}))`
  const status = !up ? '해가 졌습니다' : sun.hidden ? '해가 능선 뒤에 있습니다. 부지 전체가 그늘' : `앞 열 그림자에 가린 모듈 면적 ${(sun.shaded * 100).toFixed(0)}%`
  return (
    <figure className="lp-day">
      <div className="lp-day-head">
        <p className="lp-clock">
          <span className="lp-sr">동지 태양시 </span>
          {fmtClock(hour)}
        </p>
        <p className="lp-day-meta">
          12월 22일 동지 · 태양시
          <br />
          {up ? `고도 ${sun.alt.toFixed(1)}° · ${dirName(sun.az)}` : '해가 지평선 아래'}
        </p>
      </div>

      <div className="lp-view">
        <svg className="lp-sky" viewBox={`0 0 ${SKY_W} ${SKY_H}`} style={{ background: sky }} aria-hidden="true">
          <path className="lp-sky-path" d={SUN_PATH} />
          {up && <circle className="lp-sun" cx={skyX(sun.az)} cy={skyY(sun.alt)} r="9" />}
          <path className="lp-ridge" d={RIDGE_PATH} />
          <rect className="lp-ground" x="0" y={HORIZON_Y} width={SKY_W} height={SKY_H - HORIZON_Y} />
          <line className="lp-horizon" x1="0" x2={SKY_W} y1={HORIZON_Y} y2={HORIZON_Y} />
          {[
            [-45, '남동'],
            [0, '남'],
            [45, '남서'],
          ].map(([a, t]) => (
            <text key={t} x={skyX(a as number)} y={(HORIZON_Y + SKY_H) / 2}>
              {t}
            </text>
          ))}
        </svg>

        <svg className="lp-plan" viewBox={`-4 -2 140 ${PLAN_H + 4}`} role="img" aria-label={`예시 부지 배치도, 태양시 ${fmtClock(hour)}. ${status}`}>
          <defs>
            <clipPath id="lp-parcel-clip">
              <polygon points={PARCEL_PTS} />
            </clipPath>
          </defs>
          <polygon className="lp-parcel" points={PARCEL_PTS} />
          <g className="lp-sets">
            {SETS.map(({ x, y }) => (
              <rect key={`${x},${y}`} x={x} y={PLAN_H - y - SET_DEPTH} width={SET_WIDTH} height={SET_DEPTH} />
            ))}
          </g>
          <g className="lp-shadows" clipPath="url(#lp-parcel-clip)">
            {!sun.hidden && sun.shadows.map((s, i) => <polygon key={i} points={s.map(toSvg).join(' ')} />)}
            <rect className={`lp-dusk${sun.hidden ? ' is-on' : ''}`} x="-4" y="-2" width="140" height={PLAN_H + 4} />
          </g>
          <polygon className="lp-parcel-line" points={PARCEL_PTS} />
          <g className="lp-north" transform="translate(126 10)">
            <path d="M0,-6 L3,3 L0,1 L-3,3 Z" />
            <text y="9">N</text>
          </g>
          <g className="lp-scale" transform={`translate(4 ${PLAN_H})`}>
            <path d="M0,0 H20" />
            <text x="22" y="1.2">
              20 m
            </text>
          </g>
        </svg>
      </div>

      <figcaption>
        <strong>{status}</strong>
        <span>
          {up && !sun.hidden ? `그림자 길이 ${sun.shadowLen.toFixed(1)} m · ` : ''}예시 부지 북위 {LAT}° · 열 이격 {ROW_SPACING.toFixed(1)} m
        </span>
      </figcaption>
    </figure>
  )
}

/** 처음 들어오면 보이는 소개 화면 */
export default function Landing({ onStart }: Props) {
  const { refs, hour, active } = useDayClock()
  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-brand" href="#top">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="3" y="9" width="18" height="11" rx="1.5" transform="skewX(-12) translate(2 0)" />
            <path d="M8 9v11M13 9v11M3.5 14.5h17" />
            <circle cx="18.5" cy="4.5" r="2.2" />
          </svg>
          솔라 레이아웃
        </a>
        <nav aria-label="페이지">
          <a href="#day">동지 하루</a>
          <a href="#start">시작하기</a>
        </nav>
        <button type="button" onClick={onStart}>
          설계 화면 열기
        </button>
      </header>

      <section className="lp-hero" id="top">
        <h1>
          지번만 넣으면
          <br />
          <span>AI가 가배치까지</span>
        </h1>
        <p className="lp-lead">지적도 확인부터 모듈 배치, 계절별 음영, 발전량과 경제성, 도면까지. 며칠 걸리던 부지 검토를 몇 분 안에 끝냅니다.</p>
        <JibunForm onStart={onStart} id="lp-jibun-top" />
        <p className="lp-note">회원가입 없이 바로 씁니다. 작업은 브라우저에 저장됩니다.</p>
      </section>

      <section className="lp-tour" id="day" aria-label="동지 하루 동안의 그림자와 기능">
        <div className="lp-stage">
          <DayStage hour={hour} />
        </div>
        <ol className="lp-steps">
          {BEATS.map((b, i) => (
            <li
              key={b.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={i === active ? 'is-on' : ''}
            >
              <span className="lp-step-time">{fmtClock(b.hour)}</span>
              <h2>{b.title}</h2>
              <p>{b.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-proof">
        <figure>
          <img src={IMG_BASE + 'tour-shade.jpg'} width="1440" height="810" alt="설계 화면의 음영 단계. 동지 08시 15분, 주변 산 지평선 그래프와 그늘진 세트" loading="lazy" decoding="async" />
          <figcaption>위 그림의 계산은 설계 화면의 음영 단계와 같은 식입니다. 실제 화면에서는 지형 경사와 주변 산까지 함께 봅니다.</figcaption>
        </figure>
      </section>

      <section className="lp-close" id="start">
        <h2>첫 부지를 올려 보세요</h2>
        <p>지번을 넣으면 설계 화면이 그 지번을 검색 칸에 채운 채 열립니다.</p>
        <JibunForm onStart={onStart} id="lp-jibun-bottom" />
      </section>

      <footer className="lp-foot">
        <span>솔라 레이아웃 · 태양광 배치 설계 도구</span>
        <span>지도 데이터 VWorld · OpenStreetMap</span>
      </footer>
    </div>
  )
}
