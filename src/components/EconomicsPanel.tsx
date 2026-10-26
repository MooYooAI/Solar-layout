import { useEffect, useMemo, useState } from 'react'
import { compareSales, evaluate, solveTargets, suggestRecWeight, type EconInput, type EconResult, type EconSettings } from '../lib/economics'
import type { Capex, CostParams } from '../lib/costs'
import { RACKING, type RackingType } from '../lib/catalog'
import NumberInput from './NumberInput'

export type { EconSettings }

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
  /** unit: kW당 설치단가 직접 입력, design: 배치·전기·토공 물량으로 산출 */
  capexMode: 'unit' | 'design'
  onCapexMode: (m: 'unit' | 'design') => void
  designCapex: Capex | null
  /** 전기 설계까지 반영한 발전량(클리핑·케이블 손실 포함) */
  designKWh: number | null
  costs: CostParams
  onCosts: (c: CostParams) => void
  racking: RackingType
  onResult?: (r: EconResult | null) => void
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
      <NumberInput
        min={min}
        step={step}
        value={s[k] as number}
        onValue={(v) => set(k, v as never)}
      />
      <em>{unit}</em>
    </label>
  )

  const design = props.capexMode === 'design' && props.designCapex
  const annualKWh = (design ? props.designKWh : null) ?? props.energyKWh ?? props.kWp * props.hours * 365
  const kwhSource = design && props.designKWh !== null ? '전기 설계 반영값' : props.energyKWh !== null ? '발전량 탭 계산값' : '하루 발전시간으로 추정'
  const capex = design ? props.designCapex!.total : undefined
  const input: EconInput | null = useMemo(() => (props.kWp > 0 ? { ...s, kWp: props.kWp, annualKWh, capex } : null), [s, props.kWp, annualKWh, capex])
  const result = useMemo(() => (input ? evaluate(input) : null), [input])
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
            <span className="hint">({kwhSource})</span>
          </dd>
        </dl>
        {props.energyKWh === null && !design && (
          <>
            <label className="field" style={{ marginTop: 10 }}>
              <span>하루 발전시간</span>
              <NumberInput
                min={1}
                max={6}
                step={0.1}
                value={props.hours}
                onValue={(v) => props.onHours(v)}
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
        <div className="row" style={{ marginTop: 10 }}>
          <label>
            <input type="radio" checked={props.capexMode === 'unit'} onChange={() => props.onCapexMode('unit')} /> 설치단가 직접 입력
          </label>
          <label>
            <input type="radio" checked={props.capexMode === 'design'} onChange={() => props.onCapexMode('design')} /> 설계 물량으로 산출
          </label>
        </div>
        {props.capexMode === 'unit' ? (
          <div className="grid2" style={{ marginTop: 10 }}>
            {num('unitCost', '설치단가', '만원/kW', 1)}
            <label className="field">
              <span>총 설치비</span>
              <input value={won(props.kWp * s.unitCost)} readOnly />
            </label>
          </div>
        ) : (
          <CapexCard capex={props.designCapex} kWp={props.kWp} costs={props.costs} onCosts={props.onCosts} racking={props.racking} />
        )}
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
                <NumberInput
                  min={0}
                  step={0.1}
                  value={s.recWeight}
                  onValue={(v) => set('recWeight', v)}
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

      {result && input ? (
        <>
          <Results result={result} minDscr={s.minDscr} />
          <SaleCompareCard input={input} current={s.saleMode} minDscr={s.minDscr} />
          <TargetCard input={input} result={result} settings={s} onSettings={onSettings} />
        </>
      ) : (
        <p className="hint">기본설계에서 모듈을 먼저 배치하세요.</p>
      )}
      <ResultSync result={result} onResult={props.onResult} />
    </>
  )
}

/** 계산 결과를 내보내기 탭이 쓸 수 있게 위로 올린다. */
function ResultSync({ result, onResult }: { result: EconResult | null; onResult?: (r: EconResult | null) => void }) {
  useEffect(() => {
    onResult?.(result)
  }, [result, onResult])
  return null
}

function CapexCard(props: {
  capex: Capex | null
  kWp: number
  costs: CostParams
  onCosts: (c: CostParams) => void
  racking: RackingType
}) {
  const c = props.costs
  const field = (label: string, unit: string, value: number, onChange: (v: number) => void, step = 1) => (
    <label className="field">
      <span>{label}</span>
      <NumberInput min={0} step={step} value={value} onValue={(v) => onChange(v)} />
      <em>{unit}</em>
    </label>
  )
  const set = <K extends keyof CostParams>(k: K) => (v: CostParams[K]) => props.onCosts({ ...c, [k]: v })
  return (
    <>
      {props.capex ? (
        <table className="month-table" style={{ marginTop: 10 }}>
          <tbody>
            {props.capex.items.map((i) => (
              <tr key={i.key} title={i.basis}>
                <td>
                  {i.label}
                  <small className="basis">{i.basis}</small>
                </td>
                <td>{won(i.amount)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>합계 ({fmt(props.kWp ? props.capex.total / props.kWp : 0, 1)}만원/kWp)</td>
              <td>{won(props.capex.total)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="hint">배치하면 물량을 계산합니다.</p>
      )}
      <details style={{ marginTop: 10 }}>
        <summary>단가 고치기</summary>
        <div className="grid2" style={{ marginTop: 8 }}>
          {field('모듈', '원/W', c.moduleWonPerW, set('moduleWonPerW'), 5)}
          {field('인버터', '만원/kW', c.inverterPerKW, set('inverterPerKW'), 0.5)}
          {field(`구조물(${RACKING[props.racking].label.split(' · ')[0]})`, '만원/kW', c.racking[props.racking], (v) => props.onCosts({ ...c, racking: { ...c.racking, [props.racking]: v } }), 0.5)}
          {field('기타 전기', '만원/kW', c.bosPerKW, set('bosPerKW'), 0.5)}
          {field('설치 공사', '만원/kW', c.laborPerKW, set('laborPerKW'), 0.5)}
          {field('DC 케이블', '원/m', c.dcCableWonPerM, set('dcCableWonPerM'), 100)}
          {field('AC 케이블 기본', '원/m', c.acCableBaseWonPerM, set('acCableBaseWonPerM'), 100)}
          {field('AC 케이블 ㎟당', '원/m', c.acCableWonPerMm2M, set('acCableWonPerMm2M'), 10)}
          {field('절토', '원/㎥', c.cutWonPerM3, set('cutWonPerM3'), 500)}
          {field('성토', '원/㎥', c.fillWonPerM3, set('fillWonPerM3'), 500)}
          {field('저압 연계', '만원', c.gridFixedLV, set('gridFixedLV'), 50)}
          {field('특고압 연계 고정', '만원', c.gridFixed, set('gridFixed'), 100)}
          {field('변압기·수전', '만원/kVA', c.transformerPerKVA, set('transformerPerKVA'), 0.5)}
          {field('설계·인허가·감리', '%', c.indirectPct, set('indirectPct'), 0.5)}
        </div>
        <p className="hint">시장 참고값으로 넣어 둔 단가입니다. 견적을 받으면 바꿔 넣으세요. AI 설계의 LCOE 비교도 이 단가를 씁니다.</p>
      </details>
    </>
  )
}

const ratio = (v: number | null) => (v === null ? '-' : fmt(v, 2))

function Results({ result: r, minDscr }: { result: EconResult; minDscr: number }) {
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
        <dt>LCOE</dt>
        <dd>{fmt(r.lcoe, 1)} 원/kWh</dd>
        {r.dscrMin !== null && (
          <>
            <dt>DSCR</dt>
            <dd>
              최소 {ratio(r.dscrMin)} · 평균 {ratio(r.dscrAvg)}{' '}
              {r.dscrMin < minDscr ? <span className="rv-badge warn">기준 {minDscr} 미달</span> : <span className="rv-badge ok">기준 {minDscr} 이상</span>}
            </dd>
          </>
        )}
        <dt>누적 수익</dt>
        <dd>{won(r.flows.at(-1)?.cumulative ?? 0)} ({r.flows.length}년)</dd>
      </dl>
      <CashChart result={r} />
      {r.loanSchedule.length > 0 && <LoanTable result={r} />}
      {r.dscrMin !== null && <p className="hint">DSCR은 해마다 (매출 − 운영비) ÷ 원리금입니다. 대출기관은 보통 1.2~1.3 이상을 요구합니다.</p>}
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
            <th>DSCR</th>
          </tr>
        </thead>
        <tbody>
          {result.loanSchedule.map((l) => (
            <tr key={l.year}>
              <td>{l.year}</td>
              <td>{fmt(l.balance)}</td>
              <td>{fmt(l.interest)}</td>
              <td>{fmt(l.principal)}</td>
              <td>{ratio(result.flows[l.year - 1]?.dscr ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">단위: 만원</p>
    </details>
  )
}

function SaleCompareCard({ input, current, minDscr }: { input: EconInput; current: EconSettings['saleMode']; minDscr: number }) {
  const rows = useMemo(() => compareSales(input), [input])
  const best = rows.reduce((a, c) => ((c.result.npv > a.result.npv ? c : a)), rows[0])
  const line = (label: string, f: (r: EconResult) => string) => (
    <tr>
      <td>{label}</td>
      {rows.map((c) => (
        <td key={c.mode}>{f(c.result)}</td>
      ))}
    </tr>
  )
  return (
    <section className="card">
      <h2>판매 방식 비교</h2>
      <p>같은 설치비·융자 조건에서 판매 방식만 바꿨을 때입니다. 단가는 위 판매 방식 카드의 값을 씁니다.</p>
      <table className="order-table compare">
        <thead>
          <tr>
            <th />
            {rows.map((c) => (
              <th key={c.mode} className={c.mode === current ? 'current' : undefined}>
                {c.label}
                {c.mode === current && <small className="cell-sub">지금 선택</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line('판매 단가', (r) => `${fmt(r.unitPrice, 1)} 원/kWh`)}
          {line('1년차 매출', (r) => won(r.flows[0]?.revenue ?? 0))}
          {line('자기자본 IRR', (r) => pct(r.equityIrr))}
          {line('사업 IRR', (r) => pct(r.projectIrr))}
          {line('회수기간', (r) => (r.payback === null ? '기간 내 불가' : `${fmt(r.payback, 1)} 년`))}
          {line('NPV', (r) => won(r.npv))}
          {line('최소 DSCR', (r) => (r.dscrMin === null ? '-' : `${ratio(r.dscrMin)}${r.dscrMin < minDscr ? ' (미달)' : ''}`))}
        </tbody>
      </table>
      <p className="hint">
        NPV 기준으로는 <strong>{best.label}</strong>이 유리합니다. 현물은 SMP·REC 가격이 해마다 바뀌므로 지금 단가가 그대로 간다고 본 값입니다.
      </p>
    </section>
  )
}

function TargetCard(props: { input: EconInput; result: EconResult; settings: EconSettings; onSettings: (s: EconSettings) => void }) {
  const { settings: s, input, result: r } = props
  const set = <K extends keyof EconSettings>(k: K, v: EconSettings[K]) => props.onSettings({ ...s, [k]: v })
  const t = useMemo(() => solveTargets(input), [input])
  const now = s.targetBasis === 'equity' && r.equity > 0 ? r.equityIrr : r.projectIrr
  const meets = now !== null && now >= s.targetIrr / 100
  return (
    <section className="card">
      <h2>목표 수익률 역산</h2>
      <p>목표 IRR과 대출기관의 DSCR 기준을 넣으면, 맞출 수 있는 설치비·판매 단가·융자 비율의 한계를 거꾸로 구합니다.</p>
      <div className="grid2" style={{ marginTop: 10 }}>
        <label className="field">
          <span>목표 IRR</span>
          <NumberInput min={0} step={0.5} value={s.targetIrr} onValue={(v) => set('targetIrr', v)} />
          <em>%</em>
        </label>
        <label className="field">
          <span>기준</span>
          <select value={s.targetBasis} onChange={(e) => set('targetBasis', e.target.value as EconSettings['targetBasis'])}>
            <option value="equity">자기자본 IRR</option>
            <option value="project">사업 IRR</option>
          </select>
        </label>
        <label className="field">
          <span>최소 DSCR</span>
          <NumberInput min={1} step={0.05} value={s.minDscr} onValue={(v) => set('minDscr', v)} />
        </label>
      </div>
      <p className="hint">
        지금 {s.targetBasis === 'equity' ? '자기자본' : '사업'} IRR {pct(now)}:{' '}
        {meets ? <span className="rv-badge ok">목표 달성</span> : <span className="rv-badge warn">목표 미달</span>}
      </p>
      <table className="order-table compare">
        <thead>
          <tr>
            <th>항목</th>
            <th>지금</th>
            <th>한계</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>총 설치비</td>
            <td>
              {won(r.capex)}
              <small className="cell-sub">{fmt(r.capex / input.kWp, 1)} 만원/kW</small>
            </td>
            <td>
              {t.maxCapex === null ? '계산 불가' : `최대 ${won(t.maxCapex)}`}
              {t.maxCapex !== null && <small className="cell-sub">{fmt(t.maxCapex / input.kWp, 1)} 만원/kW</small>}
            </td>
          </tr>
          <tr>
            <td>판매 단가</td>
            <td>{fmt(r.unitPrice, 1)} 원/kWh</td>
            <td>{t.minPrice === null ? '계산 불가' : `최저 ${fmt(t.minPrice, 1)} 원/kWh`}</td>
          </tr>
          <tr>
            <td>융자 비율</td>
            <td>{fmt(s.loanRatio)} %</td>
            <td>{t.maxLoanRatio === null ? '계산 불가' : `최대 ${fmt(t.maxLoanRatio)} %`}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint">
        설치비 한계는 견적 협상의 상한으로, 판매 단가 한계는 고정가격 입찰가의 하한으로 쓰세요. 융자 비율 한계는 해마다 DSCR이 기준 이상인 최대
        비율입니다.
      </p>
    </section>
  )
}
