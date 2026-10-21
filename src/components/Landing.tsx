import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DAY_OF_YEAR, declination, rowSpacingForNoShade, sunPosition } from '../lib/sun'
import '../landing.css'

interface Props {
  onStart: () => void
}

/* ── 히어로: 직접 돌려 보는 음영 단면 ──
 * 2단 세로 세트(모듈 2.28 m × 2, 경사 30°, 지면 0.5 m) 세 열을 옆에서 본 단면.
 * 날짜와 시각을 고르면 한국 위도(36°N)의 태양으로 앞 열 그림자가 뒤 열에 닿는지 계산한다. */
const LAT = 36
const TILT = 30
const SLOPE = 2.28 * 2
const BASE = 0.5
const TOP = BASE + SLOPE * Math.sin((TILT * Math.PI) / 180)
const DEPTH = SLOPE * Math.cos((TILT * Math.PI) / 180)
/** 동지 9~15시 무음영 이격(앞 세트 뒤끝 → 뒷 세트 앞끝) */
const GAP = rowSpacingForNoShade(LAT, TOP - BASE)

const SEASONS = [
  { key: 'winter', label: '동지', day: DAY_OF_YEAR.winterSolstice },
  { key: 'spring', label: '춘분', day: DAY_OF_YEAR.springEquinox },
  { key: 'summer', label: '하지', day: DAY_OF_YEAR.summerSolstice },
] as const

function fmtHour(h: number) {
  const m = Math.round(h * 60)
  // 시계 표기(09:15)라 0을 채운다. taste-skill-ignore
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function ShadeSection() {
  const [season, setSeason] = useState<(typeof SEASONS)[number]['key']>('winter')
  const [hour, setHour] = useState(8.5)
  const day = SEASONS.find((s) => s.key === season)!.day
  const { altitude, azimuth } = sunPosition(LAT, declination(day), hour)
  const up = altitude > 0
  // 남북 단면에 투영한 태양 고도: tan(고도)/cos(방위)
  const tanEff = up ? Math.tan(altitude) / Math.max(0.05, Math.cos(azimuth)) : 0
  const reach = up ? (TOP - BASE) / tanEff : Infinity
  // 뒤 열 모듈면 위에서 그림자가 덮는 길이(m, 경사면 따라)
  const rise = (TOP - BASE) / DEPTH
  const covered = up && reach > GAP ? Math.min(SLOPE, ((TOP - BASE - GAP * tanEff) / (tanEff + rise)) * Math.hypot(1, rise)) : 0
  // 0.5 % 아래는 계산 오차로 보고 음영 없음으로 둔다
  const pct = covered / SLOPE < 0.005 ? 0 : covered / SLOPE

  // 그림 좌표: 1 m = 22 px, 지면 y = 190
  const S = 22
  const G = 190
  const x0 = 30
  const rows = [0, 1, 2].map((i) => x0 + i * (DEPTH + GAP) * S)
  const altDeg = (altitude * 180) / Math.PI
  const azDeg = (azimuth * 180) / Math.PI
  const azText = Math.abs(azDeg) < 1 ? '정남' : azDeg < 0 ? `남동 ${Math.round(-azDeg)}°` : `남서 ${Math.round(azDeg)}°`

  return (
    <div className="lp-shade" data-ui>
      <div className="lp-shade-bar">
        <div className="lp-seg" role="radiogroup" aria-label="날짜">
          {SEASONS.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={season === s.key} onClick={() => setSeason(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <label className="lp-time">
          <span>{fmtHour(hour)}</span>
          <input type="range" min={7} max={17} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="시각 (태양시)" />
        </label>
      </div>

      <svg viewBox="0 70 560 160" role="img" aria-label={`${fmtHour(hour)} 태양 고도 ${altDeg.toFixed(1)}도, 뒤 열 음영 ${Math.round(pct * 100)}%`}>
        <rect x="0" y={G} width="560" height="40" className="lp-ground" />
        {/* 해: 첫 세트 윗변에서 해 쪽으로 */}
        {up && <circle cx={rows[0] + DEPTH * S - Math.min(70, 60 / tanEff)} cy={G - TOP * S - Math.min(70 * tanEff, 60)} r="9" className="lp-sun" />}
        {rows.map((x, i) => {
          const shadeHere = i > 0 && pct > 0
          const bx = x
          const by = G - BASE * S
          const tx = x + DEPTH * S
          const ty = G - TOP * S
          return (
            <g key={i}>
              <path d={`M${tx} ${ty} L${tx} ${G}`} className="lp-post" />
              <path d={`M${bx + 6} ${by + 4} L${bx + 6} ${G}`} className="lp-post" />
              <path d={`M${bx} ${by} L${tx} ${ty}`} className="lp-panel" />
              {shadeHere && <path d={`M${bx} ${by} L${bx + (tx - bx) * pct} ${by + (ty - by) * pct}`} className="lp-panel-shade" />}
              {/* 그림자 선: 앞 세트 윗변에서 지면/뒤 세트까지 */}
              {up && i < 2 && (
                <path
                  d={`M${tx} ${ty} L${tx + Math.min(reach, 30) * S} ${ty + Math.min(reach, 30) * S * tanEff}`}
                  className="lp-ray"
                />
              )}
            </g>
          )
        })}
        <g className="lp-dim-gap">
          <path d={`M${rows[0] + DEPTH * S} ${G + 16} H${rows[1]}`} />
          <text x={(rows[0] + DEPTH * S + rows[1]) / 2} y={G + 28}>
            이격 {GAP.toFixed(2)} m
          </text>
        </g>
      </svg>

      <dl className="lp-readout">
        <div>
          <dt>태양 고도</dt>
          <dd>{up ? `${altDeg.toFixed(1)}°` : '해 없음'}</dd>
        </div>
        <div>
          <dt>방위</dt>
          <dd>{up ? azText : '–'}</dd>
        </div>
        <div>
          <dt>뒤 열 음영</dt>
          <dd className={pct > 0 ? 'is-bad' : 'is-ok'}>{!up ? '–' : pct > 0 ? `패널 ${Math.round(pct * 100)}% 가림` : '없음'}</dd>
        </div>
      </dl>
    </div>
  )
}

/* ── AI가 비교한 배치안 (예시 부지 16,967 ㎡) ── */
const PLANS = [
  { name: '경사 15° · 이격 3.4 m', kwp: 1160, mwh: 1392, lcoe: 121, loss: 7.5, tag: '음영 큼' },
  { name: '경사 20° · 이격 4.2 m', kwp: 1092, mwh: 1371, lcoe: 118, loss: 4.8, tag: '후보' },
  { name: '경사 25° · 이격 5.0 m', kwp: 1026, mwh: 1339, lcoe: 114, loss: 2.9, tag: '후보' },
  { name: '경사 30° · 이격 6.0 m', kwp: 941, mwh: 1262, lcoe: 112, loss: 0.9, tag: '최적' },
  { name: '경사 30° · 이격 5.6 m', kwp: 968, mwh: 1288, lcoe: 113, loss: 1.6, tag: '후보' },
  { name: '경사 33° · 이격 6.6 m', kwp: 902, mwh: 1212, lcoe: 115, loss: 0.7, tag: '후보' },
  { name: '경사 35° · 이격 7.1 m', kwp: 870, mwh: 1166, lcoe: 117, loss: 0.6, tag: '후보' },
  { name: '3단 · 경사 30° · 이격 8.8 m', kwp: 1010, mwh: 1295, lcoe: 116, loss: 1.2, tag: '후보' },
]

function PlanBoard() {
  const [open, setOpen] = useState(3)
  return (
    <div className="lp-board" data-ui>
      {PLANS.map((p, i) => (
        <button
          key={p.name}
          type="button"
          className={`lp-row${open === i ? ' is-open' : ''}`}
          aria-expanded={open === i}
          onClick={() => setOpen(i)}
        >
          <span className="lp-row-name">{p.name}</span>
          <span className="lp-row-fact">{p.kwp.toLocaleString('ko-KR')} kWp</span>
          <span className="lp-row-fact">{p.mwh.toLocaleString('ko-KR')} MWh</span>
          <span className="lp-row-fact">{p.lcoe} 원/kWh</span>
          <span className={`lp-row-tag tag-${p.tag === '최적' ? 'best' : p.tag === '음영 큼' ? 'bad' : 'mid'}`}>{p.tag}</span>
          {open === i && (
            <span className="lp-row-detail">
              연간 {p.mwh.toLocaleString('ko-KR')} MWh, kWp당 {Math.round((p.mwh * 1000) / p.kwp).toLocaleString('ko-KR')} kWh. 음영 손실 {p.loss}%.
              {p.tag === '최적' ? ' 동지 9~15시에 앞 열 그림자가 닿지 않는 최소 이격이라 kWh당 비용이 가장 낮습니다.' : ''}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* ── 간격 설정: 고정된 배치도 + 오른쪽 컨트롤 ── */
const LOT_W = 60
const LOT_D = 40
const MOD_W = 1.134
const MOD_H = 2.278

function LayoutPlan({ panelGap, setGap, rowGap, tiers, removed, onToggle }: {
  panelGap: number
  setGap: number
  rowGap: number
  tiers: number
  removed: Set<string>
  onToggle: (id: string) => void
}) {
  const perSet = 10
  const setW = perSet * MOD_W + (perSet - 1) * (panelGap / 1000)
  const setD = tiers * MOD_H * Math.cos((TILT * Math.PI) / 180)
  const margin = 1
  const cols = Math.max(1, Math.floor((LOT_W - 2 * margin + setGap / 1000) / (setW + setGap / 1000)))
  const rows = Math.max(1, Math.floor((LOT_D - 2 * margin + rowGap) / (setD + rowGap)))
  const sets: Array<{ id: string; x: number; y: number }> = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) sets.push({ id: `${r}-${c}`, x: margin + c * (setW + setGap / 1000), y: margin + r * (setD + rowGap) })
  const live = sets.filter((s) => !removed.has(s.id)).length
  const modules = live * perSet * tiers
  const k = 8 // 1 m = 8 px
  return (
    <figure className="lp-plan" data-ui>
      <svg viewBox={`-4 -4 ${LOT_W * k + 8} ${LOT_D * k + 8}`} role="img" aria-label={`세트 ${live}개, 모듈 ${modules}장`}>
        <rect x="0" y="0" width={LOT_W * k} height={LOT_D * k} className="lp-lot" />
        {sets.map((s) => (
          <rect
            key={s.id}
            x={s.x * k}
            y={s.y * k}
            width={setW * k}
            height={setD * k}
            className={removed.has(s.id) ? 'lp-set is-off' : 'lp-set'}
            onClick={() => onToggle(s.id)}
          />
        ))}
      </svg>
      <figcaption>
        <span>
          세트 <b>{live}</b>개
        </span>
        <span>
          모듈 <b>{modules.toLocaleString('ko-KR')}</b>장
        </span>
        <span>
          <b>{((modules * 550) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}</b> kWp
        </span>
      </figcaption>
    </figure>
  )
}

function SpacingSection() {
  const [panelGap, setPanelGap] = useState(20)
  const [setGap, setSetGap] = useState(500)
  const [rowGap, setRowGap] = useState(6)
  const [tiers, setTiers] = useState(2)
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const need = useMemo(() => rowSpacingForNoShade(LAT, tiers * MOD_H * Math.sin((TILT * Math.PI) / 180)), [tiers])
  const toggle = (id: string) =>
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <section className="lp-spacing" id="spacing">
      <div className="lp-spacing-stage">
        <LayoutPlan panelGap={panelGap} setGap={setGap} rowGap={rowGap} tiers={tiers} removed={removed} onToggle={toggle} />
      </div>
      <div className="lp-spacing-copy">
        <h2 className="lp-reveal">간격은 직접 정합니다</h2>

        <div className="lp-block lp-reveal">
          <p className="lp-say">패널 사이 틈을 mm 단위로.</p>
          <p>같은 세트 안의 모듈 간격입니다. 클램프와 시공 여유에 맞춰 넣으면 세트 폭이 바로 바뀝니다.</p>
          <label className="lp-ctl">
            <span>패널 간격</span>
            <input type="range" min={0} max={100} step={5} value={panelGap} onChange={(e) => setPanelGap(Number(e.target.value))} />
            <output>{panelGap} mm</output>
          </label>
        </div>

        <div className="lp-block lp-reveal">
          <p className="lp-say">세트와 세트 사이도 따로.</p>
          <p>같은 열에서 옆 세트와 띄우는 거리입니다. 점검 통로가 필요하면 넓히세요.</p>
          <label className="lp-ctl">
            <span>세트 간격</span>
            <input type="range" min={0} max={2000} step={50} value={setGap} onChange={(e) => setSetGap(Number(e.target.value))} />
            <output>{setGap} mm</output>
          </label>
        </div>

        <div className="lp-block lp-reveal">
          <p className="lp-say">앞뒤 열 이격은 그림자로 판단합니다.</p>
          <p>
            {tiers}단 세트라면 동지 9~15시에 앞 열 그림자가 닿지 않으려면 {need.toFixed(2)} m가 필요합니다.{' '}
            {rowGap + 1e-9 >= need ? '지금 값은 음영이 없습니다.' : '지금 값은 겨울 아침저녁에 뒤 열이 가려집니다.'}
          </p>
          <label className="lp-ctl">
            <span>열 이격거리</span>
            <input type="range" min={2} max={10} step={0.1} value={rowGap} onChange={(e) => setRowGap(Number(e.target.value))} />
            <output>{rowGap.toFixed(1)} m</output>
          </label>
        </div>

        <div className="lp-block lp-reveal">
          <p className="lp-say">단 수를 바꾸면 이격도 다시.</p>
          <p>세트가 높아지면 그림자가 길어집니다. 3단으로 올리면 열은 줄고 세트당 모듈은 늘어납니다.</p>
          <div className="lp-seg" role="radiogroup" aria-label="단 수">
            {[1, 2, 3].map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tiers === t} onClick={() => setTiers(t)}>
                {t}단
              </button>
            ))}
          </div>
        </div>

        <div className="lp-block lp-reveal">
          <p className="lp-say">마지막은 손으로 고칩니다.</p>
          <p>배치도의 세트를 눌러 빼거나 되살려 보세요. 설계 화면에서는 끌어 옮기고, 회전·복제·미세 이동까지 됩니다.</p>
          <button type="button" className="lp-ghost" onClick={() => setRemoved(new Set())} disabled={removed.size === 0}>
            뺀 세트 {removed.size}개 되돌리기
          </button>
        </div>

        <figure className="lp-shot lp-reveal">
          <img src="/landing/layout-edit.jpg" width="742" height="848" alt="설계 화면의 배치 편집 탭. 세트 10개를 선택해 미세 이동하는 모습" loading="lazy" />
          <figcaption>설계 화면의 배치 편집. 선택한 세트를 0.1 m 단위로 옮깁니다.</figcaption>
        </figure>
      </div>
    </section>
  )
}

/* ── FAQ ── */
const FAQ = [
  {
    q: 'VWorld 키가 없어도 쓸 수 있나요?',
    a: '지번 검색과 연속지적도는 VWorld 오픈API 키가 있어야 불러옵니다. 키가 없으면 지도에 영역을 직접 그리거나 가로·세로 치수를 넣어 같은 설계를 할 수 있습니다.',
  },
  {
    q: '음영은 무엇까지 계산하나요?',
    a: '부지 위도로 날짜·시각마다 태양 위치를 구해 앞 열 그림자를 보고, 반경 5 km 지형으로 주변 산이 해를 가리는 각도까지 반영합니다. 건물이나 나무는 높이를 넣어 직접 그려 넣습니다.',
  },
  {
    q: '발전량은 어떤 기준인가요?',
    a: '한국 기상 권역별 월 일사량과 기온으로 월별 발전량을 계산하고, 음영 손실과 온도 손실을 뺍니다. 결과는 월별 표와 연간 합계로 나옵니다.',
  },
  {
    q: '어떤 파일로 받을 수 있나요?',
    a: '배치도와 결선도 DXF, 도면 SVG, 수치 CSV, 인쇄용 PDF 보고서를 받습니다. 도면은 표지부터 공사계획 평면도, 단선결선도, 절·성토 평면도까지 묶여 나옵니다.',
  },
  {
    q: '작업은 어디에 저장되나요?',
    a: '브라우저에 저장됩니다. 저장·불러오기로 여러 부지를 오가고, 타임라인에서 이전 상태로 되돌릴 수 있습니다.',
  },
  {
    q: '비용이 드나요?',
    a: '지금은 회원가입 없이 무료로 씁니다. 지도와 지적도는 VWorld와 OpenStreetMap의 공개 데이터를 씁니다.',
  },
]

/** 화면에 들어오면 .in 클래스를 붙여 등장 애니메이션을 시작한다. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.classList.add('js')
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
      { threshold: 0.12 },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  return ref
}

function useKst() {
  const fmt = () => new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
  const [t, setT] = useState(fmt)
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 20000)
    return () => clearInterval(id)
  }, [])
  return t
}

/** 처음 들어오면 보이는 소개 화면 */
export default function Landing({ onStart }: Props) {
  const ref = useReveal()
  const kst = useKst()
  const [jibun, setJibun] = useState('전라남도 해남군 산이면 구성리 100')
  const [mount, setMount] = useState<'ground' | 'roof'>('ground')
  return (
    <div className="lp" ref={ref}>
      <section className="lp-hero" id="top">
        <div className="lp-hero-left">
          <a className="lp-mark" href="#top" aria-label="솔라 레이아웃 처음으로">
            솔라 레이아웃
          </a>
          <div className="lp-hero-copy">
            <h1 className="lp-lines">
              <span className="line">
                <span data-line style={{ '--i': 0 } as CSSProperties}>
                  지번만 넣으면
                </span>
              </span>
              <span className="line">
                <span data-line style={{ '--i': 1 } as CSSProperties}>
                  태양광 가배치
                </span>
              </span>
            </h1>
            <p className="lp-lead lp-after">
              지적도를 불러와 모듈을 앉히고, 한국 위도의 계절별 그림자와 연간 발전량까지 몇 분 안에 계산합니다. 옆의 단면에서 동지 아침 그림자를 직접 움직여 보세요.
            </p>
            <button type="button" className="lp-btn lp-after" onClick={onStart}>
              부지 검토 시작
            </button>
          </div>
        </div>
        <div className="lp-hero-right">
          <a className="lp-toplink" href="#faq">
            자주 묻는 질문
          </a>
          <ShadeSection />
        </div>
      </section>

      <section className="lp-showcase" id="plans">
        <div className="lp-head-row lp-reveal">
          <h2>AI가 비교한 배치안</h2>
          <p>예시 부지 16,967 ㎡에서 경사각과 이격을 바꿔 만든 안입니다. 줄을 눌러 열어 보세요.</p>
        </div>
        <PlanBoard />
      </section>

      <section className="lp-how" id="how">
        <h2 className="lp-reveal">이렇게 씁니다</h2>
        <ol>
          <li className="lp-reveal">
            <p className="lp-say">먼저, 지번을 넣습니다.</p>
            <div className="lp-call" data-ui>
              <span className="lp-input">전라남도 해남군 산이면 구성리 100</span>
              <span className="lp-input-btn">검색</span>
            </div>
            <dl className="lp-resp lp-parcel" data-ui>
              <div>
                <dt>지목</dt>
                <dd>전</dd>
              </div>
              <div>
                <dt>면적</dt>
                <dd>16,967 ㎡ (5,133 평)</dd>
              </div>
              <div>
                <dt>용도지역</dt>
                <dd>계획관리지역</dd>
              </div>
              <div>
                <dt>공시지가</dt>
                <dd>㎡당 21,400원</dd>
              </div>
            </dl>
          </li>
          <li className="lp-reveal">
            <p className="lp-say">다음, 모듈과 간격을 고릅니다.</p>
            <div className="lp-call" data-ui>
              <span className="lp-chip">550 W</span>
              <span className="lp-chip">가로 10장</span>
              <span className="lp-chip">2단</span>
              <span className="lp-chip">경사 30°</span>
              <span className="lp-chip">정남</span>
            </div>
            <figure className="lp-resp lp-shot">
              <img src="/landing/site-3d.jpg" width="742" height="848" alt="필지 안에 모듈 3,060장이 자동 배치된 3D 지형 화면" loading="lazy" />
              <figcaption>지형 위에 자동 배치된 1,683 kWp. 산 모양까지 3D로 봅니다.</figcaption>
            </figure>
          </li>
          <li className="lp-reveal">
            <p className="lp-say">그러면 도면과 보고서가 나옵니다.</p>
            <figure className="lp-resp lp-wide lp-shot">
              <img src="/landing/drawings.jpg" width="1144" height="848" alt="도면 탭. 공사계획 평면도와 15종 도면 목록" loading="lazy" />
              <figcaption>표지부터 단선결선도, 절·성토 평면도까지 15종. DXF와 PDF로 받습니다.</figcaption>
            </figure>
          </li>
        </ol>
      </section>

      <SpacingSection />

      <section className="lp-terrain">
        <figure className="lp-shot lp-reveal">
          <img src="/landing/shade-terrain.jpg" width="964" height="848" alt="음영 단계 화면. 동지 08시 15분, 주변 산 지평선 그래프와 붉게 표시된 그늘진 세트" loading="lazy" />
        </figure>
        <div className="lp-terrain-copy lp-reveal">
          <h2>산 그림자도 셈에 넣습니다</h2>
          <p>
            부지 중심에서 방위마다 5 km까지 가장 높이 솟은 지형의 각도를 구합니다. 해가 그 선보다 낮으면 부지 전체가 그늘로 잡히고, 하루 직달 일사 손실이
            발전량에 바로 반영됩니다.
          </p>
        </div>
      </section>

      <section className="lp-faq" id="faq">
        <h2 className="lp-reveal">자주 묻는 질문</h2>
        <div className="lp-faq-list">
          {FAQ.map((f, i) => (
            <details key={f.q} name="lp-faq" className="lp-reveal" open={i === 1}>
              <summary>
                {f.q}
                <i aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-cta" id="start">
        <div className="lp-cta-copy lp-reveal">
          <h2>
            첫 부지를
            <br />
            올려 보세요
          </h2>
          <p>설계 화면이 열리면 지번 검색 칸에서 바로 시작합니다. 회원가입은 없습니다.</p>
        </div>
        <form
          className="lp-dialog lp-reveal"
          data-ui
          onSubmit={(e) => {
            e.preventDefault()
            onStart()
          }}
        >
          <p className="lp-dialog-title">새 부지 검토</p>
          <label>
            <span>지번</span>
            <input value={jibun} onChange={(e) => setJibun(e.target.value)} />
          </label>
          <div className="lp-dialog-field">
            <span>설치 형태</span>
            <div className="lp-seg" role="radiogroup" aria-label="설치 형태">
              <button type="button" role="radio" aria-checked={mount === 'ground'} onClick={() => setMount('ground')}>
                지상
              </button>
              <button type="button" role="radio" aria-checked={mount === 'roof'} onClick={() => setMount('roof')}>
                지붕
              </button>
            </div>
          </div>
          <button type="submit" className="lp-btn lp-btn-full">
            설계 화면 열기
          </button>
        </form>
      </section>

      <footer className="lp-foot">
        <div className="lp-tile lp-t-say">
          <p>태양광 부지 검토를 몇 분 안에.</p>
          <small>© 2026 솔라 레이아웃 · 초안</small>
        </div>
        <nav className="lp-tile lp-t-nav" aria-label="바닥글">
          <a href="#plans">배치안 비교</a>
          <a href="#how">쓰는 법</a>
          <a href="#spacing">간격 설정</a>
          <a href="#faq">자주 묻는 질문</a>
        </nav>
        <div className="lp-tile lp-t-time">
          <p>한국 표준시</p>
          <p className="lp-big">{kst}</p>
        </div>
        <div className="lp-tile lp-t-data">
          <p>지도 데이터</p>
          <p>VWorld · OpenStreetMap</p>
        </div>
        <div className="lp-tile lp-t-word">솔라 레이아웃</div>
        <button type="button" className="lp-tile lp-t-go" onClick={onStart}>
          <span>설계 시작하기</span>
          <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
            <path d="M8 40 L40 8 M16 8 H40 V32" />
          </svg>
        </button>
      </footer>
    </div>
  )
}
