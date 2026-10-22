import { useMemo } from 'react'
import type { Parcel } from '../lib/parcel'
import { SQM_PER_PYEONG } from '../lib/parcel'
import type { LayoutParams, LayoutStats } from '../lib/layout'
import type { EnergyResult } from '../lib/energy'
import type { ElecResult } from '../lib/electrical'
import { evaluate } from '../lib/economics'
import type { EconSettings } from './EconomicsPanel'

export interface OverviewStep {
  key: string
  label: string
  done: boolean
}

interface Props {
  parcel: Parcel | null
  area: number
  zoning: string[]
  siteKind: string
  params: LayoutParams
  stats: LayoutStats
  energy: EnergyResult | null
  elec: ElecResult | null
  econ: EconSettings
  econHours: number
  steps: OverviewStep[]
  onGo: (key: string) => void
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })
const won = (manwon: number) => (Math.abs(manwon) >= 10000 ? `${fmt(manwon / 10000, 2)} 억원` : `${fmt(manwon)} 만원`)
const az = (a: number) => (Math.abs(a) < 0.05 ? '정남' : `${a > 0 ? '서' : '동'} ${fmt(Math.abs(a), 1)}°`)
const pct = (v: number | null) => (v === null ? '-' : `${fmt(v * 100, 1)} %`)

/** 오른쪽 개요: 부지·배치·전기·발전량·경제성을 한눈에 보고, 빈 단계로 바로 간다. */
export default function Overview(props: Props) {
  const { parcel, stats, params: p, energy, elec } = props
  const annualKWh = energy ? energy.specificYield * stats.kWp : stats.kWp * props.econHours * 365
  const econ = useMemo(
    () => (stats.kWp > 0 ? evaluate({ ...props.econ, kWp: stats.kWp, annualKWh }) : null),
    [props.econ, stats.kWp, annualKWh],
  )
  const done = props.steps.filter((s) => s.done).length

  if (!parcel)
    return <p className="empty overview-empty">필지를 고르거나 영역을 그리면 여기에 프로젝트 개요가 나옵니다.</p>

  const go = (key: string, label: string) => (
    <button type="button" className="link" onClick={() => props.onGo(key)}>
      {label} →
    </button>
  )

  return (
    <div className="overview">
      <section className="ov-card">
        <h3>진행 상황 <span>{done}/{props.steps.length}</span></h3>
        <div className="ov-progress" aria-hidden="true">
          <div style={{ width: `${(done / props.steps.length) * 100}%` }} />
        </div>
        <ol className="ov-steps">
          {props.steps.map((s) => (
            <li key={s.key} className={s.done ? 'done' : undefined}>
              <button type="button" onClick={() => props.onGo(s.key)}>
                <i aria-hidden="true">{s.done ? '✓' : ''}</i>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="ov-card">
        <h3>부지</h3>
        <dl className="facts wide">
          <dt>소재지</dt>
          <dd>{parcel.address}</dd>
          <dt>설치 장소</dt>
          <dd>{props.siteKind}</dd>
          {parcel.landCategory && (
            <>
              <dt>지목</dt>
              <dd>{parcel.landCategory}</dd>
            </>
          )}
          <dt>면적</dt>
          <dd>
            {fmt(props.area)} ㎡ ({fmt(props.area / SQM_PER_PYEONG)} 평)
          </dd>
          {props.zoning.length > 0 && (
            <>
              <dt>용도지역</dt>
              <dd>{props.zoning.join(', ')}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="ov-card">
        <h3>배치</h3>
        {stats.sets ? (
          <dl className="facts wide">
            <dt>모듈</dt>
            <dd>
              {fmt(p.moduleWatt)} W × {fmt(stats.modules)}장
            </dd>
            <dt>경사·방위</dt>
            <dd>
              {fmt(p.tilt, 1)}° · {az(p.azimuth)}
            </dd>
            <dt>열 이격</dt>
            <dd>{fmt(p.rowSpacing, 2)} m</dd>
          </dl>
        ) : (
          <p className="hint">아직 세트가 없습니다. {go('layout', '배치하기')}</p>
        )}
      </section>

      <section className="ov-card">
        <h3>전기</h3>
        {elec ? (
          <dl className="facts wide">
            <dt>인버터</dt>
            <dd>
              {fmt(elec.inverters.length)}대 · 스트링 {fmt(elec.strings.length)}개
            </dd>
            <dt>DC / AC</dt>
            <dd>
              {fmt(elec.kWdc, 1)} / {fmt(elec.kWac, 1)} kW ({fmt(elec.dcAc, 2)})
            </dd>
            <dt>연계</dt>
            <dd>{elec.connection === 'MV' ? `특고압${elec.transformerKVA ? ` · 변압기 ${fmt(elec.transformerKVA)} kVA` : ''}` : '저압'}</dd>
          </dl>
        ) : (
          <p className="hint">{stats.sets ? '전기 설계를 계산하는 중이거나 아직 없습니다.' : '세트를 배치하면 스트링·인버터를 묶습니다.'}</p>
        )}
      </section>

      <section className="ov-card">
        <h3>발전량</h3>
        {stats.sets ? (
          <dl className="facts wide">
            <dt>연간</dt>
            <dd>
              <strong>{fmt(annualKWh / 1000, 1)} MWh</strong>
              {!energy && <small> (추정)</small>}
            </dd>
            <dt>발전시간</dt>
            <dd>{fmt(annualKWh / Math.max(1e-9, stats.kWp) / 365, 2)} h/일</dd>
            {energy && (
              <>
                <dt>음영 손실</dt>
                <dd>{fmt(energy.shadeLoss * 100, 1)} %</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="hint">세트를 배치하면 계산합니다.</p>
        )}
        {stats.sets > 0 && !energy && <p className="hint">하루 {fmt(props.econHours, 1)}시간 기준 추정치입니다. {go('energy', '발전량 계산')}</p>}
      </section>

      <section className="ov-card">
        <h3>경제성</h3>
        {econ ? (
          <dl className="facts wide">
            <dt>사업비</dt>
            <dd>{won(econ.capex)}</dd>
            <dt>회수기간</dt>
            <dd>
              <strong>{econ.payback === null ? '기간 내 불가' : `${fmt(econ.payback, 1)} 년`}</strong>
            </dd>
            <dt>IRR</dt>
            <dd>
              자기자본 {pct(econ.equityIrr)} · 사업 {pct(econ.projectIrr)}
            </dd>
            <dt>LCOE</dt>
            <dd>{fmt(econ.lcoe, 1)} 원/kWh</dd>
          </dl>
        ) : (
          <p className="hint">세트를 배치하면 계산합니다.</p>
        )}
        {econ && <p className="hint">경제성 탭 설정 기준입니다. {go('econ', '설정 보기')}</p>}
      </section>
    </div>
  )
}
