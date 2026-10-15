import { useMemo, useState } from 'react'
import type { Parcel } from '../lib/parcel'
import { SQM_PER_PYEONG } from '../lib/parcel'
import { setQuadLonLat, type LayoutParams, type LayoutStats, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Obstacle } from '../lib/shading'
import { dailyShadeLoss, snapshot, type Scene } from '../lib/analysis'
import { dayOfYear, declination, kstToSolar } from '../lib/sun'
import type { EnergyResult } from '../lib/energy'
import { evaluate } from '../lib/economics'
import type { EconSettings } from './EconomicsPanel'

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
  onClose: () => void
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })
const won = (manwon: number) => (Math.abs(manwon) >= 10000 ? `${fmt(manwon / 10000, 2)} 억원` : `${fmt(manwon)} 만원`)

const SEASONS = [
  { name: '춘분', month: 3, day: 21 },
  { name: '하지', month: 6, day: 21 },
  { name: '추분', month: 9, day: 23 },
  { name: '동지', month: 12, day: 22 },
]

export default function ReportView(props: Props) {
  const { parcel, params: p, stats, scene, energy } = props

  // 계절별 하루 음영 손실. 세트가 많으면 무거우므로 보고서를 열 때 한 번만 계산한다.
  const seasonal = useMemo(
    () =>
      scene && props.sets.length
        ? SEASONS.map((s) => ({ ...s, loss: dailyShadeLoss(scene, declination(dayOfYear(s.month, s.day))) }))
        : null,
    [scene, props.sets.length],
  )

  const annualKWh = energy ? energy.specificYield * stats.kWp : stats.kWp * props.econHours * 365
  const econ = useMemo(
    () => (stats.kWp > 0 ? evaluate({ ...props.econ, kWp: stats.kWp, annualKWh }) : null),
    [props.econ, stats.kWp, annualKWh],
  )
  // 보고서를 연 날짜로 고정한다.
  const [today] = useState(() => new Date().toLocaleDateString('ko-KR'))

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
        <header className="report-head">
          <h1>태양광 입지검토 보고서</h1>
          <p>
            {parcel.address} · 작성일 {today}
          </p>
        </header>

        <h2>1. 부지 개요</h2>
        <table className="report-table">
          <tbody>
            <tr>
              <th>소재지</th>
              <td>{parcel.address}</td>
            </tr>
            {parcel.lots && parcel.lots.length > 1 && (
              <tr>
                <th>구성 지번</th>
                <td>
                  {parcel.lots.map((l) => (
                    <div key={l.pnu}>
                      {l.address} ({l.landCategory ?? '지목 미상'}, {fmt(l.area)} ㎡)
                    </div>
                  ))}
                </td>
              </tr>
            )}
            {parcel.landCategory && (
              <tr>
                <th>지목</th>
                <td>{parcel.landCategory}</td>
              </tr>
            )}
            <tr>
              <th>면적</th>
              <td>
                {fmt(props.area)} ㎡ ({fmt(props.area / SQM_PER_PYEONG)} 평)
              </td>
            </tr>
            {props.zoning.length > 0 && (
              <tr>
                <th>용도지역</th>
                <td>{props.zoning.join(', ')}</td>
              </tr>
            )}
            {parcel.jiga !== undefined && (
              <tr>
                <th>공시지가</th>
                <td>
                  {fmt(parcel.jiga)} 원/㎡ {parcel.jigaYear && `(${parcel.jigaYear}년)`}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h2>2. 배치도</h2>
        <PlanDrawing {...props} />

        <h2>3. 배치 조건과 결과</h2>
        <div className="report-cols">
          <table className="report-table">
            <tbody>
              <tr>
                <th>모듈</th>
                <td>
                  {p.moduleLength}×{p.moduleWidth} mm, {p.moduleWatt} W, {p.portrait ? '세로' : '가로'} 배치
                </td>
              </tr>
              <tr>
                <th>세트 구성</th>
                <td>
                  {p.setCols}열 × {p.setRows}단 ({props.geometry.modules}장, {fmt(props.geometry.width, 1)}×
                  {fmt(props.geometry.depth, 1)} m)
                </td>
              </tr>
              <tr>
                <th>경사각·방위각</th>
                <td>
                  {p.tilt}°, {p.azimuth === 0 ? '정남' : `${p.azimuth > 0 ? '서' : '동'} ${Math.abs(p.azimuth)}°`}
                </td>
              </tr>
              <tr>
                <th>간격</th>
                <td>
                  패널 {p.moduleGap} mm, 세트 {p.setGap} mm, 열 이격 {p.rowSpacing} m, 경계 이격 {p.boundarySetback} m
                </td>
              </tr>
              {props.suggestedRowSpacing !== null && (
                <tr>
                  <th>동지 무음영 이격</th>
                  <td>{fmt(props.suggestedRowSpacing, 2)} m (9~15시 기준)</td>
                </tr>
              )}
            </tbody>
          </table>
          <table className="report-table">
            <tbody>
              <tr>
                <th>세트</th>
                <td>{fmt(stats.sets)} 개</td>
              </tr>
              <tr>
                <th>모듈</th>
                <td>{fmt(stats.modules)} 장</td>
              </tr>
              <tr>
                <th>설비용량</th>
                <td>
                  <strong>{fmt(stats.kWp, 2)} kWp</strong>
                </td>
              </tr>
              <tr>
                <th>점유율</th>
                <td>{fmt(stats.coverage * 100, 1)} %</td>
              </tr>
              <tr>
                <th>장애물</th>
                <td>{props.obstacles.length ? props.obstacles.map((o) => `${o.name} ${o.height} m`).join(', ') : '없음'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>4. 계절별 음영</h2>
        {seasonal ? (
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
        ) : (
          <p className="hint">배치된 세트가 없습니다.</p>
        )}
        <p className="note">하루 동안 해 높이로 가중한 평균 그늘 비율(세트 간 그림자와 장애물 포함)입니다.</p>

        <h2>5. 예상 발전량</h2>
        {energy ? (
          <>
            <p>
              연간 <strong>{fmt(annualKWh / 1000, 1)} MWh</strong>, 하루 평균 발전시간 {fmt(energy.specificYield / 365, 2)}시간(
              {fmt(energy.specificYield)} kWh/kWp), 음영 손실 {fmt(energy.shadeLoss * 100, 1)} %
            </p>
            <table className="report-table numeric">
              <thead>
                <tr>
                  {energy.monthly.map((m) => (
                    <th key={m.month}>{m.month}월</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {energy.monthly.map((m) => (
                    <td key={m.month}>{fmt((m.kWh / 1000) * (stats.kWp / Math.max(1e-9, energy.annualKWh / energy.specificYield)), 1)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="note">단위 MWh. 한국 평균 월별 일사량과 성능계수로 계산한 예상값입니다.</p>
          </>
        ) : (
          <p>
            발전량 탭을 계산하지 않아 하루 {props.econHours}시간 발전으로 추정했습니다: 연간 {fmt(annualKWh / 1000, 1)} MWh
          </p>
        )}

        <h2>6. 경제성</h2>
        {econ ? (
          <table className="report-table">
            <tbody>
              <tr>
                <th>총 설치비</th>
                <td>
                  {won(econ.capex)} ({props.econ.unitCost} 만원/kW), 자기자본 {won(econ.equity)}, 융자 {won(econ.loan)}
                </td>
              </tr>
              <tr>
                <th>판매</th>
                <td>
                  {props.econ.saleMode === 'fixed'
                    ? `고정가격 계약 ${fmt(econ.unitPrice, 1)} 원/kWh`
                    : `SMP ${props.econ.smp} + REC ${fmt(props.econ.recPrice)}원 × ${props.econ.recWeight} = ${fmt(econ.unitPrice, 1)} 원/kWh`}
                </td>
              </tr>
              <tr>
                <th>1년차 매출·순수익</th>
                <td>
                  {won(econ.flows[0]?.revenue ?? 0)} / {won(econ.flows[0]?.equityFlow ?? 0)}
                </td>
              </tr>
              <tr>
                <th>회수기간</th>
                <td>
                  <strong>{econ.payback === null ? '기간 내 불가' : `${fmt(econ.payback, 1)} 년`}</strong>
                </td>
              </tr>
              <tr>
                <th>IRR</th>
                <td>
                  자기자본 {econ.equityIrr === null ? '-' : `${fmt(econ.equityIrr * 100, 1)} %`}, 사업{' '}
                  {econ.projectIrr === null ? '-' : `${fmt(econ.projectIrr * 100, 1)} %`}
                </td>
              </tr>
              <tr>
                <th>NPV</th>
                <td>
                  {won(econ.npv)} (할인율 {props.econ.discountRate} %, {props.econ.years}년)
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="hint">배치된 세트가 없습니다.</p>
        )}

        <p className="note disclaimer">
          이 보고서는 공개 지적·용도지역 정보와 입력한 가정으로 계산한 검토용 추정치입니다. 실제 인허가, 구조 안전, 계통 연계 가능
          여부와 사업 수익은 관할 기관과 전문가 검토로 확인해야 합니다.
        </p>
      </article>
    </div>
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
