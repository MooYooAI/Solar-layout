import { useMemo, useState } from 'react'
import { evaluate, suggestRecWeight, type EconInput, type EconResult } from '../lib/economics'

export type EconSettings = Omit<EconInput, 'kWp' | 'annualKWh'>

interface Props {
  kWp: number
  /** 발전량 탭에서 계산한 1년차 발전량, 아직 없으면 null */
  energyKWh: number | null
  landCategory?: string
  settings: EconSettings
  onSettings: (s: EconSettings) => void
  /** 발전량 계산 전에 쓸 하루 발전시간 */
  hours: number
  onHours: (h: number) => void
  onGoEnergy: () => void
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })
const pct = (v: number | null) => (v === null ? '계산 불가' : `${fmt(v * 100, 1)} %`)
/** 만원 → 읽기 쉬운 단위 */
const won = (manwon: number) =>
  Math.abs(manwon) >= 10000 ? `${fmt(manwon / 10000, 2)} 억원` : `${fmt(manwon)} 만원`

export default function EconomicsPanel(props: Props) {
  const { settings: s, onSettings } = props
  const set = <K extends keyof EconSettings>(k: K, v: EconSettings[K]) => onSettings({ ...s, [k]: v })
  const num = (k: keyof EconSettings, label: string, unit: string, step = 1, min = 0) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={s[k] as number}
        onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && set(k, e.target.valueAsNumber as never)}
      />
      <em>{unit}</em>
    </label>
  )

  const annualKWh = props.energyKWh ?? props.kWp * props.hours * 365
  const result = useMemo(
    () => (props.kWp > 0 ? evaluate({ ...s, kWp: props.kWp, annualKWh }) : null),
    [s, props.kWp, annualKWh],
  )
  const suggested = suggestRecWeight(props.kWp, props.landCategory)

  return (
    <>
      <section className="card">
        <h2>사업 조건</h2>
        <dl className="facts">
          <dt>설비용량</dt>
          <dd>{fmt(props.kWp, 2)} kWp</dd>
          <dt>발전량</dt>
          <dd>
            {fmt(annualKWh / 1000, 1)} MWh/년{' '}
            <span className="hint">({props.energyKWh !== null ? '발전량 탭 계산값' : '하루 발전시간으로 추정'})</span>
          </dd>
        </dl>
        {props.energyKWh === null && (
          <>
            <label className="field" style={{ marginTop: 10 }}>
              <span>하루 발전시간</span>
              <input
                type="number"
                min={1}
                max={6}
                step={0.1}
                value={props.hours}
                onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && props.onHours(e.target.valueAsNumber)}
              />
              <em>시간</em>
            </label>
            <p className="hint">
              <button type="button" className="link" onClick={props.onGoEnergy}>
                발전량 탭
              </button>
              에서 계산하면 음영까지 반영한 값으로 바뀝니다.
            </p>
          </>
        )}
        <div className="grid2" style={{ marginTop: 10 }}>
          {num('unitCost', '설치단가', '만원/kW', 1)}
          <label className="field">
            <span>총 설치비</span>
            <input value={won(props.kWp * s.unitCost)} readOnly />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>판매 방식</h2>
        <div className="row">
          <label>
            <input type="radio" checked={s.saleMode === 'fixed'} onChange={() => set('saleMode', 'fixed')} /> 고정가격 계약(입찰·PPA)
          </label>
          <label>
            <input type="radio" checked={s.saleMode === 'spot'} onChange={() => set('saleMode', 'spot')} /> SMP + REC 현물
          </label>
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          {s.saleMode === 'fixed' ? (
            num('fixedPrice', '계약 단가', '원/kWh', 0.1)
          ) : (
            <>
              {num('smp', 'SMP', '원/kWh', 0.1)}
              {num('recPrice', 'REC 가격', '원/REC', 100)}
              <label className="field">
                <span>REC 가중치</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={s.recWeight}
                  onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && set('recWeight', e.target.valueAsNumber)}
                />
              </label>
              <label className="field">
                <span>판매 단가</span>
                <input value={`${fmt(s.smp + (s.recPrice / 1000) * s.recWeight, 1)} 원/kWh`} readOnly />
              </label>
            </>
          )}
        </div>
        {s.saleMode === 'spot' && s.recWeight !== suggested && (
          <p className="hint">
            이 용량{props.landCategory === '임' ? '·임야' : ''}의 참고 가중치는 {suggested}입니다.{' '}
            <button type="button" className="link" onClick={() => set('recWeight', suggested)}>
              적용
            </button>
          </p>
        )}
      </section>

      <section className="card">
        <h2>운영·융자</h2>
        <div className="grid2">
          {num('opexRate', '운영비', '%/년', 0.1)}
          {num('landRent', '토지 임대료', '만원/년', 10)}
          {num('degradation', '효율 감소', '%/년', 0.1)}
          {num('years', '분석 기간', '년', 1, 1)}
          {num('loanRatio', '융자 비율', '%', 5)}
          {num('loanRate', '이자율', '%', 0.1)}
          {num('loanYears', '상환 기간', '년', 1, 1)}
          {num('graceYears', '거치 기간', '년', 1)}
          <label className="field">
            <span>상환 방식</span>
            <select value={s.repayment} onChange={(e) => set('repayment', e.target.value as EconSettings['repayment'])}>
              <option value="annuity">원리금균등</option>
              <option value="equalPrincipal">원금균등</option>
            </select>
          </label>
          {num('discountRate', '할인율', '%', 0.1)}
        </div>
        <p className="hint">운영비는 설치비 대비 비율로, 유지보수·보험·안전관리 대행비를 합친 값입니다.</p>
      </section>

      {result ? <Results result={result} /> : <p className="hint">배치 탭에서 모듈을 먼저 배치하세요.</p>}
    </>
  )
}

function Results({ result: r }: { result: EconResult }) {
  const first = r.flows[0]
  return (
    <section className="card">
      <h2>경제성 결과</h2>
      <div className="hero">
        회수기간 <strong>{r.payback === null ? '기간 내 불가' : fmt(r.payback, 1)}</strong>
        {r.payback !== null && '년'}
      </div>
      <dl className="facts wide">
        <dt>총 설치비</dt>
        <dd>{won(r.capex)}</dd>
        <dt>자기자본</dt>
        <dd>
          {won(r.equity)} (융자 {won(r.loan)})
        </dd>
        <dt>판매 단가</dt>
        <dd>{fmt(r.unitPrice, 1)} 원/kWh</dd>
        <dt>1년차 매출</dt>
        <dd>{won(first?.revenue ?? 0)}</dd>
        <dt>1년차 순수익</dt>
        <dd>{won(first?.equityFlow ?? 0)} (원리금 상환 후)</dd>
        <dt>자기자본 IRR</dt>
        <dd>{pct(r.equityIrr)}</dd>
        <dt>사업 IRR</dt>
        <dd>{pct(r.projectIrr)}</dd>
        <dt>NPV</dt>
        <dd>{won(r.npv)}</dd>
        <dt>누적 수익</dt>
        <dd>{won(r.flows.at(-1)?.cumulative ?? 0)} ({r.flows.length}년)</dd>
      </dl>
      <CashChart result={r} />
      {r.loanSchedule.length > 0 && <LoanTable result={r} />}
      <p className="hint">
        입력한 단가와 가정으로 낸 추정치이며 세금과 물가상승, 인버터 교체비는 넣지 않았습니다. 실제 사업 판단에는 계약 조건과 견적을
        따로 확인하세요.
      </p>
    </section>
  )
}

function CashChart({ result }: { result: EconResult }) {
  const [hover, setHover] = useState<number | null>(null)
  const vals = [-result.equity, ...result.flows.map((f) => f.cumulative)]
  const max = Math.max(0, ...vals)
  const min = Math.min(0, ...vals)
  const W = 300
  const H = 150
  const pad = { l: 4, r: 4, t: 18, b: 16 }
  const bw = (W - pad.l - pad.r) / vals.length
  const y = (v: number) => pad.t + ((H - pad.t - pad.b) * (max - v)) / Math.max(1e-9, max - min)
  const y0 = y(0)
  return (
    <div className="chart">
      <div className="chart-head">
        <span>누적 현금흐름 (자기자본 기준)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="연도별 누적 현금흐름 막대그래프" onMouseLeave={() => setHover(null)}>
        {vals.map((v, i) => {
          const x = pad.l + i * bw
          const top = Math.min(y(v), y0)
          const h = Math.max(1, Math.abs(y(v) - y0))
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <rect
                x={x + 1}
                y={top}
                width={Math.max(1, bw - 2)}
                height={h}
                rx={1.5}
                className={`bar${v < 0 ? ' neg' : ''}${hover === i ? ' active' : ''}`}
              />
              {(i % 5 === 0 || i === vals.length - 1) && (
                <text x={x + bw / 2} y={H - 3} className="tick">
                  {i}
                </text>
              )}
            </g>
          )
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y0} y2={y0} className="axis" />
        {hover !== null && (
          <text x={Math.min(W - 60, Math.max(60, pad.l + hover * bw + bw / 2))} y={12} className="tip">
            {hover}년차 {won(vals[hover])}
          </text>
        )}
      </svg>
    </div>
  )
}

function LoanTable({ result }: { result: EconResult }) {
  return (
    <details className="chart">
      <summary className="chart-head">융자 상환표</summary>
      <table className="month-table">
        <thead>
          <tr>
            <th>연차</th>
            <th>기초 잔액</th>
            <th>이자</th>
            <th>원금</th>
          </tr>
        </thead>
        <tbody>
          {result.loanSchedule.map((l) => (
            <tr key={l.year}>
              <td>{l.year}</td>
              <td>{fmt(l.balance)}</td>
              <td>{fmt(l.interest)}</td>
              <td>{fmt(l.principal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">단위: 만원</p>
    </details>
  )
}
