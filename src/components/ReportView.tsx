import { useMemo, useState } from 'react'
import type { Parcel } from '../lib/parcel'
import { SQM_PER_PYEONG } from '../lib/parcel'
import { setQuadLonLat, type LayoutParams, type LayoutStats, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Obstacle } from '../lib/shading'
import { dailyShadeLoss, snapshot, terrainSunWindow, type Scene } from '../lib/analysis'
import { dayOfYear, declination, kstToSolar, solarToKst, sunriseSunsetSolar } from '../lib/sun'
import type { EnergyResult } from '../lib/energy'
import { evaluate, suggestRecWeight, type EconResult } from '../lib/economics'
import type { EconSettings } from './EconomicsPanel'
import type { TerrainResult } from '../lib/terrain'
import type { DesignResult } from '../lib/design'
import type { ElecResult } from '../lib/electrical'
import type { Horizon } from '../lib/horizon'
import { LocalFrame } from '../lib/geo'
import SideElevation from './SideElevation'
import {
  CAPACITY_BANDS,
  VERDICT_LABEL,
  capacityNearMiss,
  isFarmland,
  isForest,
  licensingAuthority,
  noonAltitude,
  overallGrade,
  pctToDeg,
  permitList,
  reviewObstacles,
  schedule,
  smallEia,
  tiltStudy,
  type SectionReview,
  type Verdict,
} from '../lib/siteReview'

interface Props {
  parcel: Parcel
  area: number
  zoning: string[]
  params: LayoutParams
  geometry: SetGeometry
  stats: LayoutStats
  sets: ModuleSet[]
  obstacles: Obstacle[]
  scene: Scene | null
  suggestedRowSpacing: number | null
  energy: EnergyResult | null
  econ: EconSettings
  econHours: number
  terrain: TerrainResult | null
  design: DesignResult | null
  /** 설치비를 전기 설계 물량으로 잡았으면 그 합계(만원) */
  designCapex: number | null
  horizon: Horizon | null
  onClose: () => void
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })
const won = (manwon: number) => (Math.abs(manwon) >= 10000 ? `${fmt(manwon / 10000, 2)} 억원` : `${fmt(manwon)} 만원`)
const pct = (v: number | null, d = 1) => (v === null ? '-' : `${fmt(v * 100, d)} %`)
const hhmm = (h: number) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const azText = (a: number) => (Math.abs(a) < 0.05 ? '정남' : `${a > 0 ? '서' : '동'} ${fmt(Math.abs(a), 1)}°`)

const SEASONS = [
  { name: '춘분', month: 3, day: 21 },
  { name: '하지', month: 6, day: 21 },
  { name: '추분', month: 9, day: 23 },
  { name: '동지', month: 12, day: 22 },
]

function Badge({ v, children }: { v: Verdict; children?: React.ReactNode }) {
  return <span className={`rv-badge ${v}`}>{children ?? VERDICT_LABEL[v]}</span>
}

function Section({ no, title, review, children }: { no: string; title: string; review?: SectionReview; children: React.ReactNode }) {
  return (
    <section className={`rv-section${review && review.verdict === 'bad' ? ' alert' : ''}`} id={`rv-${no}`}>
      <header>
        <h2>
          <span>{no}</span>
          {title}
        </h2>
        {review && <Badge v={review.verdict} />}
      </header>
      {children}
    </section>
  )
}

function Kv({ rows }: { rows: Array<[string, React.ReactNode] | null | false | undefined> }) {
  return (
    <table className="rv-kv">
      <tbody>
        {rows.filter(Boolean).map((r) => {
          const [k, v] = r as [string, React.ReactNode]
          return (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Metric({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="rv-metric">
      <span>{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      {note && <em>{note}</em>}
    </div>
  )
}

export default function ReportView(props: Props) {
  const { parcel, params: p, stats, scene, energy, design, terrain } = props
  const frame = useMemo(() => LocalFrame.around(parcel.rings), [parcel])
  const lat = frame.lat0
  const lon = frame.lon0
  const land = parcel.landCategory

  // 계절별 하루 음영 손실. 세트가 많으면 무거우므로 보고서를 열 때 한 번만 계산한다.
  const seasonal = useMemo(
    () =>
      scene && props.sets.length
        ? SEASONS.map((s) => ({ ...s, loss: dailyShadeLoss(scene, declination(dayOfYear(s.month, s.day))) }))
        : null,
    [scene, props.sets.length],
  )
  const study = useMemo(() => tiltStudy(lat, p.tilt, p.azimuth), [lat, p.tilt, p.azimuth])
  const winterN = dayOfYear(12, 22)
  const winterDecl = declination(winterN)
  const winterAlt = noonAltitude(lat, winterDecl)
  const summerAlt = noonAltitude(lat, declination(dayOfYear(6, 21)))
  const winterDay = sunriseSunsetSolar(lat, winterDecl)
  const winterTerrain = terrainSunWindow(props.horizon, lat, winterDecl)
  const { sets, obstacles } = props
  const obstacleRows = reviewObstacles(parcel.rings, sets, obstacles, winterAlt)

  // 발전량은 전기 설계 반영값 > 발전량 탭 > 하루 발전시간 추정 순으로 쓴다.
  const kWhSource = design ? '전기 설계 반영' : energy ? '발전량 탭 계산' : `하루 ${props.econHours}시간 추정`
  const annualKWh = design ? design.metrics.annualKWh : energy ? energy.specificYield * stats.kWp : stats.kWp * props.econHours * 365
  const shadeLoss = design ? design.metrics.shadeLoss : energy ? energy.shadeLoss : seasonal ? seasonal.reduce((a, s) => a + s.loss, 0) / 4 : null
  const monthly = design?.metrics.monthly ?? energy?.monthly ?? null
  const monthlyScale = design ? 1 : energy ? stats.kWp / Math.max(1e-9, energy.annualKWh / energy.specificYield) : 1
  const econ: EconResult | null = useMemo(
    () => (stats.kWp > 0 ? evaluate({ ...props.econ, kWp: stats.kWp, annualKWh, capex: props.designCapex ?? undefined }) : null),
    [props.econ, stats.kWp, annualKWh, props.designCapex],
  )
  const elec: ElecResult | null = design?.elec ?? null
  const installArea = stats.sets * props.geometry.width * props.geometry.depth
  const eia = smallEia(props.area, props.zoning)
  const meanSlopeDeg = terrain ? pctToDeg(terrain.meanSlopePct) : null
  const nearMiss = capacityNearMiss(stats.kWp)
  const permits = permitList(stats.kWp, parcel.address, land, props.area, eia.applies)
  const plan = schedule(stats.kWp, eia.applies, isForest(land))
  const totalMonths = plan.reduce((a, s) => a + s.months, 0)
  const [today] = useState(() => new Date().toLocaleDateString('ko-KR'))

  // ── 섹션 판정 ──
  const reviews = (() => {
    const site: SectionReview = (() => {
      const checks: string[] = []
      const badObs = obstacleRows.filter((o) => o.impact === 'bad')
      if (badObs.length) checks.push(`남쪽 장애물(${badObs.map((o) => o.name).join(', ')})의 겨울 그늘이 배치에 닿습니다. 이격이나 제거를 검토하세요.`)
      if (study.azimuthEff < 0.95) checks.push(`방위가 정남에서 벗어나 일사가 ${fmt((1 - study.azimuthEff) * 100, 1)}% 줄어듭니다.`)
      const loss = shadeLoss ?? 0
      const verdict: Verdict = !stats.sets ? 'info' : loss > 0.08 || badObs.length ? 'bad' : loss > 0.03 || study.totalEff < 0.95 ? 'warn' : 'ok'
      return {
        key: 'site',
        title: '입지환경',
        verdict,
        summary: stats.sets ? `음영 손실 ${pct(shadeLoss)}, 경사·방위 효율 ${fmt(study.totalEff * 100, 1)}%` : '배치가 없어 음영을 판정하지 않았습니다.',
        checks,
      }
    })()
    const cap: SectionReview = {
      key: 'capacity',
      title: '설계용량',
      verdict: !stats.sets ? 'bad' : nearMiss ? 'warn' : 'ok',
      summary: stats.sets ? `${fmt(stats.kWp, 1)} kWp, kW당 부지 ${fmt(stats.kWp ? props.area / stats.kWp : 0, 1)}㎡` : '배치된 세트가 없습니다.',
      checks: nearMiss ? [`설비용량이 ${fmt(nearMiss.limit)}kW를 조금 넘습니다. ${nearMiss.note}`] : [],
    }
    const civil: SectionReview = (() => {
      if (!terrain) return { key: 'civil', title: '토목·부지 조성', verdict: 'info', summary: '지형을 불러오지 않아 경사·토공량을 판정하지 않았습니다.', checks: ['지형 탭에서 표고를 불러와 경사와 절·성토량을 확인하세요.'] }
      const deg = pctToDeg(terrain.meanSlopePct)
      const verdict: Verdict = deg > 15 ? 'bad' : deg > 10 || terrain.southFacing < 0.4 ? 'warn' : 'ok'
      const checks: string[] = []
      if (deg > 10) checks.push(`평균 경사 ${fmt(deg, 1)}°로 정지 공사와 배수 계획이 필요합니다.`)
      return { key: 'civil', title: '토목·부지 조성', verdict, summary: `평균 경사 ${fmt(deg, 1)}°, 절토 ${fmt(terrain.cut)}㎥ · 성토 ${fmt(terrain.fill)}㎥`, checks }
    })()
    const permit: SectionReview = (() => {
      const checks: string[] = []
      let verdict: Verdict = 'ok'
      if (isForest(land)) {
        verdict = 'warn'
        if (meanSlopeDeg === null) checks.push('임야는 평균경사 15° 이하여야 합니다. 지형을 불러와 확인하세요.')
        else if (meanSlopeDeg > 15) {
          verdict = 'bad'
          checks.push(`임야 평균경사 ${fmt(meanSlopeDeg, 1)}°로 산지 태양광 기준(15°)을 넘습니다.`)
        } else checks.push('산지일시사용 허가와 사용 뒤 원상복구 조건을 확인하세요.')
      }
      if (isFarmland(land)) {
        verdict = verdict === 'bad' ? 'bad' : 'warn'
        checks.push('농지입니다. 농업진흥구역 여부와 농지전용 가능 여부를 확인하세요.')
      }
      if (eia.applies) {
        verdict = verdict === 'bad' ? 'bad' : 'warn'
        checks.push(`면적 ${fmt(props.area)}㎡로 소규모 환경영향평가 대상(${fmt(eia.limit ?? 0)}㎡ 이상)입니다.`)
      }
      if (props.zoning.some((z) => /자연환경보전|개발제한|보전녹지/.test(z))) {
        verdict = 'bad'
        checks.push(`용도지역(${props.zoning.join(', ')})에서 발전시설 허용 여부를 먼저 확인하세요.`)
      }
      checks.push('지자체 조례의 주거지·도로 이격거리를 확인하세요.')
      const need = permits.filter((x) => x.need === 'yes').length
      return { key: 'permit', title: '인허가', verdict, summary: `필요 인허가 ${need}건, 허가권자 ${licensingAuthority(stats.kWp, parcel.address)}`, checks }
    })()
    const grid: SectionReview = (() => {
      if (!elec) return { key: 'grid', title: '계통연계', verdict: 'info', summary: '전기 설계가 없어 연계 방식을 판정하지 않았습니다.', checks: ['한전ON에서 가까운 변전소·배전선로 여유용량을 확인하세요.'] }
      const verdict: Verdict = elec.warnings.length ? 'warn' : elec.connection === 'MV' ? 'warn' : 'ok'
      return {
        key: 'grid',
        title: '계통연계',
        verdict,
        summary: `${elec.connection === 'MV' ? '특고압' : '저압'} 연계, 인버터 ${elec.inverters.length}대, AC ${fmt(elec.kWac, 1)} kW`,
        checks: ['한전ON에서 접속 가능 용량과 표준시설부담금을 확인하세요.', ...elec.warnings],
      }
    })()
    const money: SectionReview = (() => {
      if (!econ) return { key: 'econ', title: '경제성', verdict: 'info', summary: '배치가 없어 계산하지 않았습니다.', checks: [] }
      const pb = econ.payback
      const verdict: Verdict = pb === null || pb > 15 ? 'bad' : pb > 10 ? 'warn' : 'ok'
      return {
        key: 'econ',
        title: '경제성',
        verdict,
        summary: `회수 ${pb === null ? '기간 내 불가' : `${fmt(pb, 1)}년`}, 자기자본 IRR ${pct(econ.equityIrr)}`,
        checks: verdict !== 'ok' ? ['판매 단가·설치비·융자 조건을 바꿔 사업성을 다시 보세요.'] : [],
      }
    })()
    return [site, cap, civil, permit, grid, money]
  })()

  const overall = overallGrade(reviews)
  const firstChecks = reviews.flatMap((r) => (r.verdict === 'bad' || r.verdict === 'warn' || r.verdict === 'info' ? r.checks.slice(0, 1) : [])).slice(0, 5)
  const byKey = Object.fromEntries(reviews.map((r) => [r.key, r]))

  const conclusion = stats.sets
    ? `${parcel.address} ${fmt(props.area)}㎡ 부지에 ${fmt(stats.kWp, 1)} kWp(모듈 ${fmt(stats.modules)}장)를 배치했습니다. 연간 ${fmt(annualKWh / 1000, 1)} MWh를 낼 것으로 보이며${econ ? `, 자기자본 회수기간은 ${econ.payback === null ? '사업 기간 안에 나오지 않습니다' : `약 ${fmt(econ.payback, 1)}년입니다`}` : ''}. ${overall.text}`
    : `${parcel.address} 부지에 아직 배치가 없습니다. 배치 탭에서 자동 배치를 한 뒤 다시 출력하세요.`

  const actions = [
    { what: '조례의 이격거리·개발행위 허가 기준', who: '시·군·구 허가(도시계획) 부서', when: '설계 확정 전' },
    { what: '토지이용계획 확인서 발급', who: '토지이음(eum.go.kr)', when: '부지 계약 전' },
    { what: '계통 접속 가능 용량·시설부담금', who: '한전 관할 지사, 한전ON', when: '부지 계약 전' },
    isFarmland(land) && { what: '농업진흥구역 여부, 농지전용 가능 여부', who: '시·군·구 농지 부서', when: '인허가 신청 전' },
    isForest(land) && { what: '보전·준보전산지 구분과 평균경사 조사', who: '시·군·구 산림 부서', when: '인허가 신청 전' },
    eia.applies !== false && { what: '소규모 환경영향평가 대상 여부', who: '관할 지방환경청', when: '인허가 단계' },
    { what: '진입도로 폭·포장, 시공 차량 진입', who: '현장 확인, 로드뷰', when: '부지 계약 전' },
    { what: '경계 측량, 지반 조사', who: '측량·지반조사 업체', when: '실시설계 전' },
  ].filter(Boolean) as Array<{ what: string; who: string; when: string }>

  const sources: Array<[string, string, string]> = [
    ['지적 경계·지목', parcel.source === 'vworld' ? 'VWorld 연속지적도' : '직접 그린 영역', parcel.source === 'vworld' ? '조회됨' : '지목 정보 없음'],
    ['용도지역', 'VWorld 용도지역 레이어', props.zoning.length ? '조회됨' : '자료 없음 · 확인 필요'],
    ['지형(표고·경사)', '공개 수치표고', terrain ? '불러옴' : '불러오지 않음'],
    ['주변 산 지평선', '공개 수치표고', props.horizon ? `반경 ${fmt(props.horizon.radius / 1000, 1)} km 반영` : '반영 안 함'],
    ['일사량', '전국 평균 월별 일사', '대표값'],
    ['발전량', kWhSource, design || energy ? '계산됨' : '추정'],
    ['경제성', '경제성 탭 입력 가정', '가정값'],
    ['도로·계통 여유', '현장 확인, 한전ON', '조회 안 함 · 확인 필요'],
  ]

  return (
    <div className="report">
      <div className="report-bar no-print">
        <button type="button" onClick={() => window.print()}>
          인쇄 / PDF 저장
        </button>
        <button type="button" className="secondary" onClick={props.onClose}>
          닫기
        </button>
        <span className="hint">인쇄 창에서 대상을 "PDF로 저장"으로 고르면 파일로 받을 수 있습니다.</span>
      </div>

      <article className="report-page">
        {/* 표지 */}
        <header className="rv-cover">
          <div className="rv-hero">
            <small>태양광 발전사업</small>
            <h1>입지검토 보고서</h1>
            <p>{parcel.address}</p>
            <dl>
              <div>
                <dt>설비용량</dt>
                <dd>{fmt(stats.kWp, 1)} kWp</dd>
              </div>
              <div>
                <dt>부지 면적</dt>
                <dd>{fmt(props.area)} ㎡</dd>
              </div>
              <div>
                <dt>작성일</dt>
                <dd>{today}</dd>
              </div>
            </dl>
            <span className="rv-brand">솔라 레이아웃</span>
          </div>
          <div className="rv-drawings">
            <figure>
              <figcaption>가배치도</figcaption>
              <PlanDrawing {...props} />
            </figure>
            <figure>
              <figcaption>구조물 측면도</figcaption>
              <div className="rv-side">
                <SideElevation params={p} geometry={props.geometry} lat={lat} />
              </div>
            </figure>
          </div>
          <p className="note">개략 배치도와 측면도입니다. 실시설계에서 구조·전기 상세를 확정합니다.</p>
        </header>

        {/* 핵심 요약 */}
        <section className="rv-summary">
          <div className={`rv-grade g${overall.grade}`}>
            <strong>{overall.grade}</strong>
            <span>{overall.score}점</span>
          </div>
          <div className="rv-conclusion">
            <h2>핵심 요약</h2>
            <p>{conclusion}</p>
          </div>
        </section>
        <div className="rv-strip">
          <Metric label="설비용량" value={fmt(stats.kWp, 1)} unit="kWp" note={`모듈 ${fmt(stats.modules)}장`} />
          <Metric label="연간 발전량" value={fmt(annualKWh / 1000, 1)} unit="MWh" note={kWhSource} />
          <Metric label="발전시간" value={fmt(annualKWh / Math.max(1e-9, stats.kWp) / 365, 2)} unit="h/일" />
          <Metric label="음영 손실" value={shadeLoss === null ? '-' : fmt(shadeLoss * 100, 1)} unit="%" />
          <Metric label="회수기간" value={econ?.payback == null ? '-' : fmt(econ.payback, 1)} unit="년" note="자기자본" />
          <Metric label="IRR" value={econ?.equityIrr == null ? '-' : fmt(econ.equityIrr * 100, 1)} unit="%" note="자기자본" />
        </div>
        {firstChecks.length > 0 && (
          <div className="rv-first">
            <h3>먼저 확인할 사항</h3>
            <ol>
              {firstChecks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </div>
        )}

        {/* 섹션별 평가 */}
        <h2 className="rv-h">섹션별 평가</h2>
        <div className="rv-cards">
          {reviews.map((r, i) => (
            <a key={r.key} className={`rv-card ${r.verdict}`} href={`#rv-${i + 1}`}>
              <header>
                <span>
                  {i + 1}. {r.title}
                </span>
                <Badge v={r.verdict} />
              </header>
              <p>{r.summary}</p>
            </a>
          ))}
        </div>
        {overall.unknown > 0 && <p className="note">미확인 {overall.unknown}개 섹션은 자료가 없어 점수에서 뺐습니다.</p>}

        {/* 1. 입지환경 */}
        <Section no="1" title="입지환경" review={byKey.site}>
          <h3>지리·지형</h3>
          <div className="rv-metrics">
            <Metric label="위도 · 경도" value={`${fmt(lat, 5)}, ${fmt(lon, 5)}`} />
            <Metric label="해발 고도" value={props.horizon ? fmt(props.horizon.siteElevation, 0) : '-'} unit={props.horizon ? 'm' : undefined} note={props.horizon ? '부지 중심 지반고' : '표고 미조회'} />
            <Metric
              label="평균 경사"
              value={terrain ? fmt(pctToDeg(terrain.meanSlopePct), 1) : '-'}
              unit={terrain ? '°' : undefined}
              note={terrain ? `${fmt(terrain.meanSlopePct, 1)}%, 남향 비탈 ${fmt(terrain.southFacing * 100)}%` : '지형 미조회'}
            />
          </div>
          <h3>태양 조건</h3>
          <div className="rv-metrics">
            <Metric label="동지 정오 태양고도" value={fmt(winterAlt, 1)} unit="°" note={`하지 ${fmt(summerAlt, 1)}°`} />
            <Metric
              label="동지 일조"
              value={winterDay ? `${hhmm(solarToKst(winterDay.rise, lon, winterN))}~${hhmm(solarToKst(winterDay.set, lon, winterN))}` : '-'}
              note={
                winterTerrain && winterDay
                  ? `산 그림자 반영 ${hhmm(solarToKst(winterTerrain.rise, lon, winterN))}~${hhmm(solarToKst(winterTerrain.set, lon, winterN))}`
                  : '일출~일몰(표준시)'
              }
            />
            <Metric label="최적 경사각" value={fmt(study.optimumTilt)} unit="°" note={`현재 ${fmt(p.tilt, 1)}°`} />
            <Metric label="경사 효율" value={fmt(study.tiltEff * 100, 1)} unit="%" note="최적 경사 대비" />
            <Metric label="방위 효율" value={fmt(study.azimuthEff * 100, 1)} unit="%" note={azText(p.azimuth)} />
            <Metric label="종합 효율" value={fmt(study.totalEff * 100, 1)} unit="%" note="경사 × 방위" />
          </div>
          <h3>주변 장애물과 음영</h3>
          {obstacleRows.length ? (
            <table className="report-table numeric">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>높이(m)</th>
                  <th>가까운 세트까지(m)</th>
                  <th>방향</th>
                  <th>동지 정오 그림자(m)</th>
                  <th>영향</th>
                </tr>
              </thead>
              <tbody>
                {obstacleRows.map((o) => (
                  <tr key={o.name}>
                    <td>{o.name}</td>
                    <td>{fmt(o.height, 1)}</td>
                    <td>{fmt(o.distance, 1)}</td>
                    <td>{o.direction}</td>
                    <td>{fmt(o.winterShadow, 1)}</td>
                    <td>
                      <Badge v={o.impact}>{o.impactText}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">입력한 장애물이 없습니다. 주변 건물·수목은 음영 탭에서 그려 넣을 수 있습니다.</p>
          )}
          {seasonal && (
            <table className="report-table numeric">
              <thead>
                <tr>
                  {seasonal.map((s) => (
                    <th key={s.name}>
                      {s.name} ({s.month}/{s.day})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {seasonal.map((s) => (
                    <td key={s.name}>{fmt(s.loss * 100, 1)} %</td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          <p className="note">계절별 값은 일출~일몰 동안 해 높이로 가중한 평균 그늘 비율(세트 사이 그림자와 장애물 포함)입니다.</p>
        </Section>

        {/* 2. 설계용량 */}
        <Section no="2" title="설계용량" review={byKey.capacity}>
          <div className="rv-metrics">
            <Metric label="설비용량" value={fmt(stats.kWp, 1)} unit="kWp" note={`${fmt(stats.sets)}세트 · ${fmt(stats.modules)}장`} />
            <Metric label="부지 면적" value={fmt(props.area)} unit="㎡" note={`${fmt(props.area / SQM_PER_PYEONG)}평`} />
            <Metric label="모듈 설치 면적" value={fmt(installArea)} unit="㎡" note={`점유율 ${fmt(stats.coverage * 100, 1)}%`} />
            <Metric label="kW당 부지" value={stats.kWp ? fmt(props.area / stats.kWp, 1) : '-'} unit="㎡/kW" />
            <Metric label="REC 가중치(참고)" value={fmt(suggestRecWeight(stats.kWp, land), 1)} note={isForest(land) ? '임야' : '일반부지'} />
            <Metric label="경사 · 방위" value={`${fmt(p.tilt, 1)}° · ${azText(p.azimuth)}`} note={`열 이격 ${fmt(p.rowSpacing, 2)} m`} />
          </div>
          <Kv
            rows={[
              ['모듈', `${p.moduleLength}×${p.moduleWidth} mm, ${p.moduleWatt} W, ${p.portrait ? '세로' : '가로'} 배치`],
              ['세트 구성', `${p.setCols}열 × ${p.setRows}단 (${props.geometry.modules}장, ${fmt(props.geometry.width, 1)}×${fmt(props.geometry.depth, 1)} m)`],
              ['간격', `패널 ${p.moduleGap} mm, 세트 ${p.setGap} mm, 열 이격 ${p.rowSpacing} m, 경계 이격 ${p.boundarySetback} m`],
              props.suggestedRowSpacing !== null && ['동지 무음영 이격', `${fmt(props.suggestedRowSpacing, 2)} m (9~15시 기준)`],
            ]}
          />
          <h3>용량 구간 참고</h3>
          <table className="report-table list">
            <thead>
              <tr>
                <th>구간 경계</th>
                <th>의미</th>
              </tr>
            </thead>
            <tbody>
              {CAPACITY_BANDS.map((b) => (
                <tr key={b.limit} className={nearMiss?.limit === b.limit ? 'hit' : undefined}>
                  <th>{fmt(b.limit)} kW</th>
                  <td>{b.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">경계를 조금 넘는 용량이면 열 이격이나 단수를 조정해 경계 아래로 맞추는 안과 비교해 보세요. 제도 기준은 해마다 바뀌므로 최신 고시를 확인하세요.</p>
        </Section>

        {/* 3. 토목 */}
        <Section no="3" title="토목·부지 조성" review={byKey.civil}>
          {terrain ? (
            <>
              <div className="rv-metrics">
                <Metric label="평균 경사" value={fmt(pctToDeg(terrain.meanSlopePct), 1)} unit="°" note={`최대 ${fmt(pctToDeg(terrain.maxSlopePct), 1)}°`} />
                <Metric label="표고 범위" value={`${fmt(terrain.minZ, 1)}~${fmt(terrain.maxZ, 1)}`} unit="m" />
                <Metric label="절토량" value={fmt(design?.earth?.cut ?? terrain.cut)} unit="㎥" note={design?.earth ? '배치 기준' : '부지 정지 기준'} />
                <Metric label="성토량" value={fmt(design?.earth?.fill ?? terrain.fill)} unit="㎥" />
                <Metric label="최대 절·성토 깊이" value={`${fmt(terrain.maxCut, 1)} / ${fmt(terrain.maxFill, 1)}`} unit="m" />
                <Metric label="급경사 세트" value={design?.earth ? fmt(design.earth.steepSets) : '-'} unit="개" note="구조물 허용 경사 초과" />
              </div>
              <table className="report-table numeric">
                <thead>
                  <tr>
                    <th>0~5%</th>
                    <th>5~10%</th>
                    <th>10~15%</th>
                    <th>15~20%</th>
                    <th>20% 이상</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {terrain.slopeClasses.map((v, i) => (
                      <td key={i}>{fmt(v * 100, 1)} %</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="note">경사 구간별 면적 비율입니다. 남향 비탈은 지형을 따라 정지하고, 그 밖의 비탈은 완만하게(대략 10° 이하) 조성하는 것이 일반적입니다.</p>
            </>
          ) : (
            <p className="hint">지형 탭에서 표고를 불러오면 경사, 절·성토량, 경사 구간 면적이 채워집니다.</p>
          )}
        </Section>

        {/* 4. 인허가 */}
        <Section no="4" title="인허가" review={byKey.permit}>
          <Kv
            rows={[
              ['발전사업 허가권자', `${licensingAuthority(stats.kWp, parcel.address)} (설비용량 ${fmt(stats.kWp, 1)} kW 기준)`],
              ['지목', land ?? '정보 없음'],
              ['용도지역', props.zoning.length ? props.zoning.join(', ') : '조회되지 않음, 토지이용계획 확인서로 확인'],
              parcel.lots && parcel.lots.length > 1 && ['구성 지번', parcel.lots.map((l) => `${l.address}(${l.landCategory ?? '지목 미상'})`).join(', ')],
              parcel.jiga !== undefined && ['공시지가', `${fmt(parcel.jiga)} 원/㎡ ${parcel.jigaYear ? `(${parcel.jigaYear}년)` : ''}`],
              [
                '소규모 환경영향평가',
                eia.limit === null ? '용도지역을 몰라 판정하지 못함' : `${eia.applies ? '대상' : '대상 아님'} (이 용도지역 기준 ${fmt(eia.limit)}㎡ 이상, 부지 ${fmt(props.area)}㎡)`,
              ],
              isForest(land) && ['산지 평균경사', meanSlopeDeg === null ? '지형 미조회, 15° 이하 필요' : `${fmt(meanSlopeDeg, 1)}° (기준 15° 이하)`],
            ]}
          />
          <h3>필요 인허가</h3>
          <table className="report-table list">
            <thead>
              <tr>
                <th>인허가</th>
                <th>해당</th>
                <th>근거·비고</th>
              </tr>
            </thead>
            <tbody>
              {permits.map((x) => (
                <tr key={x.name}>
                  <th>{x.name}</th>
                  <td>
                    <Badge v={x.need === 'yes' ? 'warn' : x.need === 'maybe' ? 'info' : 'ok'}>{x.need === 'yes' ? '필요' : x.need === 'maybe' ? '확인' : '해당 없음'}</Badge>
                  </td>
                  <td>{x.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            주거지·도로 이격거리와 개발행위 허가 경사 기준은 시·군·구 도시계획 조례마다 다릅니다. 이 보고서는 조례를 조회하지 않으므로 관할 부서에서 확인하세요.
          </p>
        </Section>

        {/* 5. 계통연계 */}
        <Section no="5" title="계통연계" review={byKey.grid}>
          {elec ? (
            <>
              <div className="rv-metrics">
                <Metric label="연계 방식" value={elec.connection === 'MV' ? '특고압' : '저압'} note={elec.transformerKVA ? `변압기 ${fmt(elec.transformerKVA)} kVA` : undefined} />
                <Metric label="인버터" value={fmt(elec.inverters.length)} unit="대" note={`스트링 ${fmt(elec.strings.length)}개 × ${elec.stringLen}장`} />
                <Metric label="DC / AC" value={`${fmt(elec.kWdc, 1)} / ${fmt(elec.kWac, 1)}`} unit="kW" note={`비율 ${fmt(elec.dcAc, 2)}`} />
                <Metric label="케이블" value={`${fmt(elec.dcCableM)} / ${fmt(elec.acCableM)}`} unit="m" note="DC / AC 길이" />
                <Metric label="케이블 손실" value={`${fmt(elec.dcLossPct, 2)} / ${fmt(elec.acLossPct, 2)}`} unit="%" note="DC / AC" />
                <Metric label="거래 상대(참고)" value={elec.connection === 'MV' && stats.kWp > 1000 ? '전력거래소' : '한국전력'} note="용량·계약 방식에 따라 다름" />
              </div>
              {elec.warnings.length > 0 && (
                <ul className="rv-warn">
                  {elec.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="hint">전기 탭에서 스트링·인버터를 묶으면 연계 방식과 케이블 물량이 채워집니다.</p>
          )}
          <p className="note">접속 가능 용량, 변전소·배전선로 여유, 표준시설부담금은 한전ON(online.kepco.co.kr)과 관할 지사에서 확인하세요.</p>
        </Section>

        {/* 6. 경제성 */}
        <Section no="6" title="경제성" review={byKey.econ}>
          {econ ? (
            <>
              <div className="rv-metrics four">
                <Metric label="회수기간" value={econ.payback === null ? '불가' : fmt(econ.payback, 1)} unit={econ.payback === null ? undefined : '년'} note="자기자본 기준" />
                <Metric label="1년차 순수익" value={won(econ.flows[0]?.equityFlow ?? 0)} note={`월 ${won((econ.flows[0]?.equityFlow ?? 0) / 12)}`} />
                <Metric label="IRR" value={pct(econ.equityIrr)} note={`사업 ${pct(econ.projectIrr)}`} />
                <Metric label="NPV" value={won(econ.npv)} note={`할인율 ${props.econ.discountRate}%`} />
              </div>
              <Kv
                rows={[
                  ['총 설치비', `${won(econ.capex)} (kW당 ${fmt(econ.capex / Math.max(1e-9, stats.kWp), 1)} 만원${props.designCapex ? ', 전기 설계 물량 기준' : ''})`],
                  ['자금 구성', `자기자본 ${won(econ.equity)}, 융자 ${won(econ.loan)} (${props.econ.loanRatio}%, ${props.econ.loanRate}%, ${props.econ.loanYears}년)`],
                  [
                    '판매 단가',
                    props.econ.saleMode === 'fixed'
                      ? `고정가격 계약 ${fmt(econ.unitPrice, 1)} 원/kWh`
                      : `SMP ${props.econ.smp} + REC ${fmt(props.econ.recPrice)}원 × ${props.econ.recWeight} = ${fmt(econ.unitPrice, 1)} 원/kWh`,
                  ],
                  ['1년차 매출', won(econ.flows[0]?.revenue ?? 0)],
                  ['LCOE', `${fmt(econ.lcoe, 1)} 원/kWh`],
                ]}
              />
              {design && design.metrics.capex.items.length > 0 && (
                <>
                  <h3>설치비 구성</h3>
                  <table className="report-table">
                    <tbody>
                      {design.metrics.capex.items.map((it) => (
                        <tr key={it.key}>
                          <th>{it.label}</th>
                          <td>{won(it.amount)}</td>
                          <td className="muted">{it.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <h3>누적 현금흐름(자기자본)</h3>
              <CashChart flows={econ.flows} equity={econ.equity} />
            </>
          ) : (
            <p className="hint">배치된 세트가 없습니다.</p>
          )}
          {monthly && (
            <>
              <h3>월별 발전량</h3>
              <MonthChart values={monthly.map((m) => (m.kWh / 1000) * monthlyScale)} />
            </>
          )}
          <p className="note">경제성 탭에 넣은 가정으로 낸 추정치입니다. 실제 계약 단가와 금융 조건에 따라 달라집니다.</p>
        </Section>

        {/* 7. 일정 */}
        <Section no="7" title="사업 예상 일정">
          <div className="rv-gantt" style={{ '--total': totalMonths } as React.CSSProperties}>
            {plan.reduce<{ start: number; rows: React.ReactNode[] }>(
              (acc, s) => {
                acc.rows.push(
                  <div key={s.name} className="rv-gantt-row">
                    <span>{s.name}</span>
                    <div>
                      <i style={{ marginLeft: `${(acc.start / totalMonths) * 100}%`, width: `${(s.months / totalMonths) * 100}%` }}>{s.months}개월</i>
                    </div>
                  </div>,
                )
                acc.start += s.months
                return acc
              },
              { start: 0, rows: [] },
            ).rows}
          </div>
          <p className="note">
            착수부터 상업운전까지 약 {totalMonths}개월로 봅니다. 평가 대상 여부, 계통 보강 공사, 민원에 따라 크게 늘어날 수 있습니다.
          </p>
        </Section>

        {/* 8. 종합 */}
        <Section no="8" title="종합 평가">
          <div className="rv-summary small">
            <div className={`rv-grade g${overall.grade}`}>
              <strong>{overall.grade}</strong>
              <span>{overall.score}점</span>
            </div>
            <p>{overall.text} 각 섹션의 검토 항목은 확정이 아니라 확인이 필요한 사항입니다.</p>
          </div>
          <h3>실행 권고</h3>
          <table className="report-table list">
            <thead>
              <tr>
                <th className="no">#</th>
                <th>확인할 것</th>
                <th>확인처</th>
                <th>시점</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a, i) => (
                <tr key={a.what}>
                  <td>{i + 1}</td>
                  <td>{a.what}</td>
                  <td>{a.who}</td>
                  <td>{a.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>자료 근거</h3>
          <table className="report-table list">
            <thead>
              <tr>
                <th>항목</th>
                <th>출처</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(([k, src, st]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{src}</td>
                  <td>{st}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <p className="note disclaimer">
          이 보고서는 공개 지적·용도지역 정보와 입력한 가정으로 계산한 검토용 추정치입니다. 인허가 가능 여부는 관할 기관이 판단하며, 구조
          안전, 계통 연계, 공사비와 사업 수익은 현장 조사와 관계 기관 협의, 자격 있는 전문가의 검토로 확정해야 합니다. 법률·세무·투자 자문이
          아닙니다.
        </p>
      </article>
    </div>
  )
}

/** 자기자본 누적 현금흐름 선 그래프. 0을 넘는 해가 회수 시점이다. */
function CashChart({ flows, equity }: { flows: EconResult['flows']; equity: number }) {
  const W = 640
  const H = 200
  const pad = { l: 56, r: 12, t: 12, b: 24 }
  const pts = [{ year: 0, v: -equity }, ...flows.map((f) => ({ year: f.year, v: f.cumulative }))]
  const maxV = Math.max(...pts.map((q) => q.v), 1)
  const minV = Math.min(...pts.map((q) => q.v), -1)
  const n = pts.length - 1 || 1
  const X = (y: number) => pad.l + (y / n) * (W - pad.l - pad.r)
  const Y = (v: number) => pad.t + ((maxV - v) / (maxV - minV)) * (H - pad.t - pad.b)
  const path = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.year)},${Y(q.v)}`).join(' ')
  const ticks = [minV, 0, maxV]
  return (
    <svg className="rv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="누적 현금흐름">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'zero' : 'grid'} />
          <text x={pad.l - 6} y={Y(t) + 4} textAnchor="end">
            {won(t)}
          </text>
        </g>
      ))}
      <path d={`${path} L${X(n)},${Y(0)} L${X(0)},${Y(0)} Z`} className="area" />
      <path d={path} className="line" />
      {pts
        .filter((q) => q.year % 5 === 0)
        .map((q) => (
          <text key={q.year} x={X(q.year)} y={H - 6} textAnchor="middle">
            {q.year}년
          </text>
        ))}
    </svg>
  )
}

/** 월별 발전량 막대 그래프(MWh) */
function MonthChart({ values }: { values: number[] }) {
  const W = 640
  const H = 170
  const pad = { l: 8, r: 8, t: 18, b: 22 }
  const max = Math.max(...values, 1e-9)
  const bw = (W - pad.l - pad.r) / values.length
  return (
    <svg className="rv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 발전량">
      {values.map((v, i) => {
        const h = (v / max) * (H - pad.t - pad.b)
        const x = pad.l + i * bw
        return (
          <g key={i}>
            <rect x={x + bw * 0.18} y={H - pad.b - h} width={bw * 0.64} height={h} rx={2} className="bar" />
            <text x={x + bw / 2} y={H - pad.b - h - 4} textAnchor="middle">
              {fmt(v, v < 10 ? 1 : 0)}
            </text>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle">
              {i + 1}월
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 지도 타일 없이 필지·세트·장애물·동지 정오 그림자를 벡터로 그린 배치도 */
function PlanDrawing(props: Props) {
  const { parcel, scene, sets, geometry } = props
  const frame = scene?.frame
  const drawing = useMemo(() => {
    if (!frame) return null
    const local = (r: number[][]) => r.map((c) => frame.toLocal(c))
    const rings = parcel.rings.map(local)
    const xs = rings.flat().map((v) => v[0])
    const ys = rings.flat().map((v) => v[1])
    const pad = 6
    const minX = Math.min(...xs) - pad
    const maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad
    const maxY = Math.max(...ys) + pad
    const n = dayOfYear(12, 22)
    const shade = snapshot(scene!, declination(n), kstToSolar(12, frame.lon0, n))
    return {
      minX,
      maxX,
      minY,
      maxY,
      rings,
      sets: sets.map((s) => ({ id: s.id, q: local(setQuadLonLat(s, geometry)) })),
      obstacles: props.obstacles.map((o) => local(o.ring)),
      shadows: shade.shadows.map((s) => local(s.ring)),
    }
  }, [frame, parcel, scene, sets, geometry, props.obstacles])
  if (!drawing) return null
  const { minX, maxX, minY, maxY } = drawing
  const W = maxX - minX
  const H = maxY - minY
  // SVG는 y가 아래로 커지므로 북쪽(+y)을 위로 뒤집는다.
  const pts = (r: number[][]) => r.map(([x, y]) => `${x - minX},${maxY - y}`).join(' ')
  const bar = niceLength(W / 5)
  const u = W / 100 // 글자·선 굵기 기준
  return (
    <figure className="report-plan">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="필지와 모듈 세트 배치도">
        {drawing.shadows.map((r, i) => (
          <polygon key={`sh${i}`} points={pts(r)} className="plan-shadow" />
        ))}
        {drawing.rings.map((r, i) => (
          <polygon key={`p${i}`} points={pts(r)} className="plan-parcel" strokeWidth={u * 0.5} />
        ))}
        {drawing.obstacles.map((r, i) => (
          <polygon key={`o${i}`} points={pts(r)} className="plan-obstacle" strokeWidth={u * 0.3} />
        ))}
        {drawing.sets.map((s) => (
          <polygon key={s.id} points={pts(s.q)} className="plan-set" strokeWidth={u * 0.15} />
        ))}
        <g transform={`translate(${u * 3}, ${H - u * 3})`}>
          <rect width={bar} height={u * 0.8} className="plan-scale" />
          <text y={-u * 1.2} fontSize={u * 2.6} className="plan-text">
            {bar} m
          </text>
        </g>
        <g transform={`translate(${W - u * 5}, ${u * 4})`}>
          <path d={`M0,${-u * 3} L${u * 1.5},${u * 1.5} L0,${u * 0.5} L${-u * 1.5},${u * 1.5} Z`} className="plan-north" />
          <text y={u * 4.5} fontSize={u * 2.6} textAnchor="middle" className="plan-text">
            N
          </text>
        </g>
      </svg>
      <figcaption>
        주황선 필지 경계, 파란 사각형 모듈 세트, 회색 장애물, 옅은 회색 동지 정오 그림자
      </figcaption>
    </figure>
  )
}

function niceLength(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-6)))
  const m = x / p
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p
}
