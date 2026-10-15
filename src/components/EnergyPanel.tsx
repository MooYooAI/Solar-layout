import { useState } from 'react'
import type { EnergyResult } from '../lib/energy'

interface Props {
  kWp: number
  result: EnergyResult | null
  busy: boolean
  performanceRatio: number
  onPerformanceRatio: (v: number) => void
  withShade: boolean
  onWithShade: (v: boolean) => void
  onRun: () => void
  canRun: boolean
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })

export default function EnergyPanel(props: Props) {
  const { result } = props
  return (
    <>
      <section className="card">
        <h2>발전량 계산</h2>
        <div className="grid2">
          <label className="field">
            <span>성능계수</span>
            <input
              type="number"
              min={0.5}
              max={1}
              step={0.01}
              value={props.performanceRatio}
              onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && props.onPerformanceRatio(e.target.valueAsNumber)}
            />
          </label>
          <label className="field">
            <span>설비용량</span>
            <input value={`${fmt(props.kWp, 2)} kWp`} readOnly />
          </label>
        </div>
        <label className="row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={props.withShade} onChange={(e) => props.onWithShade(e.target.checked)} /> 음영 손실 반영 (세트 간
          그림자 + 장애물)
        </label>
        <button type="button" className="block" disabled={!props.canRun || props.busy} onClick={props.onRun}>
          {props.busy ? '계산 중…' : '발전량 계산'}
        </button>
        {!props.canRun && <p className="hint">배치 탭에서 모듈을 먼저 배치하세요.</p>}
        <p className="hint">
          한국 평균 월별 일사량, 경사각·방위각, 성능계수(온도·인버터·배선 손실)로 계산한 예상값입니다. 실제 발전량은 지역과 해마다 달라집니다.
        </p>
      </section>

      {result && (
        <section className="card">
          <h2>예상 발전량</h2>
          <div className="hero">
            <strong>{fmt(result.annualKWh / 1000, 1)}</strong> MWh/년
          </div>
          <dl className="facts">
            <dt>하루 평균</dt>
            <dd>{fmt(result.annualKWh / 365)} kWh</dd>
            <dt>발전시간</dt>
            <dd>
              {fmt(result.specificYield / 365, 2)} 시간/일 ({fmt(result.specificYield)} kWh/kWp)
            </dd>
            <dt>음영 손실</dt>
            <dd>{fmt(result.shadeLoss * 100, 1)} %</dd>
          </dl>
          <MonthlyChart result={result} />
        </section>
      )}
    </>
  )
}

function MonthlyChart({ result }: { result: EnergyResult }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const max = Math.max(...result.monthly.map((m) => m.kWh))
  const W = 300
  const H = 140
  const pad = { l: 4, r: 4, t: 18, b: 18 }
  const bw = (W - pad.l - pad.r) / 12
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  return (
    <div className="chart">
      <div className="chart-head">
        <span>월별 발전량 (MWh)</span>
        <button type="button" className="link" onClick={() => setTable((t) => !t)}>
          {table ? '그래프' : '표'}
        </button>
      </div>
      {table ? (
        <table className="month-table">
          <thead>
            <tr>
              <th>월</th>
              <th>발전량</th>
              <th>음영 없을 때</th>
            </tr>
          </thead>
          <tbody>
            {result.monthly.map((m) => (
              <tr key={m.month}>
                <td>{m.month}월</td>
                <td>{fmt(m.kWh / 1000, 2)}</td>
                <td>{fmt(m.kWhNoShade / 1000, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 발전량 막대그래프" onMouseLeave={() => setHover(null)}>
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
          {result.monthly.map((m, i) => {
            const x = pad.l + i * bw
            const top = y(m.kWh)
            const h = H - pad.b - top
            const r = Math.min(4, h)
            const bx = x + 3
            const w = bw - 6
            return (
              <g key={m.month} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                <path
                  className={hover === i ? 'bar active' : 'bar'}
                  d={`M${bx},${H - pad.b} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + w - r} Q${bx + w},${top} ${bx + w},${top + r} V${H - pad.b} Z`}
                />
                <text x={x + bw / 2} y={H - 4} className="tick">
                  {m.month}
                </text>
              </g>
            )
          })}
          {hover !== null && (
            <text x={Math.min(W - 60, Math.max(30, pad.l + hover * bw + bw / 2))} y={12} className="tip">
              {result.monthly[hover].month}월 {fmt(result.monthly[hover].kWh / 1000, 2)} MWh
            </text>
          )}
        </svg>
      )}
    </div>
  )
}
