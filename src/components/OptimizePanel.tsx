import type { ReactNode } from 'react'
import { STRATEGIES, type Candidate, type Strategy } from '../lib/optimize'
import type { DesignMetrics } from '../lib/design'
import { isContinuous, setGeometry, type LayoutParams, type ModuleSet } from '../lib/layout'
import { findModule, INVERTERS, moduleName, RACKING } from '../lib/catalog'
import { azimuthMix, type ZoneMode } from '../lib/zones'

/** 비교 목록에 저장한 배치안 */
export interface Scenario {
  id: string
  name: string
  params: LayoutParams
  sets: ModuleSet[]
  metrics: DesignMetrics
  /** 저장할 때의 배치 방식 */
  layoutMode?: 'grid' | ZoneMode
  rowOffset?: number
}

interface Props {
  canRun: boolean
  running: boolean
  results: Candidate[] | null
  error: string | null
  onRun: () => void
  onCancel: () => void
  /** mode는 다시 배치할 때 쓸 배치 방식(AI 안이 고른 방식) */
  onApply: (params: LayoutParams, sets: ModuleSet[], mode?: 'grid' | ZoneMode, rowOffset?: number) => void
  current: DesignMetrics | null
  currentBusy: boolean
  scenarios: Scenario[]
  onSaveCurrent: () => void
  onRemoveScenario: (id: string) => void
  maskActive: boolean
  hasGrid: boolean
  /** 인버터를 고를 때 쓰는 목표 DC/AC 비율 */
  dcAcRatio: number
  /** 수배전반·전기실 자리를 어떻게 잡는지. 자리를 비우지 않으면 null */
  padNote: string | null
  /** 후보 아래에 덧붙이는 참고 카드(표준·권장 설계용량) */
  extra?: ReactNode
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })
const eok = (manwon: number) => fmt(manwon / 10000, 2)
const pct = (v: number | null) => (v === null ? '-' : `${fmt(v * 100, 1)}%`)
/** 카드에 적는 모듈 이름: 제조사 모델명, 없으면 일반 규격 */
const moduleLabel = (p: LayoutParams) => moduleName(findModule(p.moduleLength, p.moduleWidth, p.moduleWatt)) ?? `일반 규격 ${p.moduleLength}×${p.moduleWidth} mm`
const inverterLabel = (id: string) => INVERTERS.find((i) => i.id === id)?.label ?? id
const az = (a: number) => (a === 0 ? '정남' : `${a > 0 ? '서' : '동'} ${Math.abs(a)}°`)
/** 추천 배치안: 효율을 지키면서 발전량이 가장 많은 균형 안 */
const RECOMMENDED: Strategy = 'balanced'
/** 보여 주는 순서: 추천(균형) 다음에 발전량 최대 */
const ORDER: Strategy[] = ['balanced', 'energy', 'capacity', 'lcoe', 'yield']
const ZONE_LABEL: Record<ZoneMode, string> = {
  edge: '구역별 방위(경계 방향)',
  half: '구역별 방위(절충)',
  fill: '한 방향 + 빈자리 채우기',
}

export default function OptimizePanel(props: Props) {
  const { results } = props
  const ordered = results ? [...results].sort((a, b) => ORDER.indexOf(a.strategy) - ORDER.indexOf(b.strategy)) : null
  type Row = { key: string; name: string; m: DesignMetrics; apply?: () => void; remove?: () => void }
  const rows: Row[] = [
    ...(props.current ? [{ key: 'current', name: '현재 배치', m: props.current }] : []),
    ...props.scenarios.map((s) => ({
      key: s.id,
      name: s.name,
      m: s.metrics,
      apply: () => props.onApply(s.params, s.sets, s.layoutMode, s.rowOffset),
      remove: () => props.onRemoveScenario(s.id),
    })),
    ...(results ?? []).map((c) => ({
      key: `ai-${c.strategy}`,
      name: `AI ${STRATEGIES[c.strategy].label}`,
      m: c.metrics,
      apply: () => props.onApply(c.params, c.sets, c.zone ?? 'grid', c.rowOffset),
    })),
  ]
  const finite = rows.filter((r) => Number.isFinite(r.m.lcoe))
  const bestLcoe = finite.length ? Math.min(...finite.map((r) => r.m.lcoe)) : NaN
  const bestEnergy = rows.length ? Math.max(...rows.map((r) => r.m.annualKWh)) : NaN

  return (
    <>
      <section className="card">
        <h2>AI 추천 배치</h2>
        <ul className="hint checklist">
          <li>{props.maskActive ? '설계 가능 영역(경사·배수 제외)을 반영합니다.' : '설계 가능 영역을 반영하려면 지형 탭에서 지형을 불러오세요.'}</li>
          <li>{props.hasGrid ? '배치마다 세트 자리 토공량을 계산합니다.' : '지형을 불러오지 않아 토공량은 빠집니다.'}</li>
          <li>모듈은 기본설계에서 고른 모듈로 계산하고, 인버터는 안마다 용량에 맞춰 고릅니다(목표 DC/AC {fmt(props.dcAcRatio, 2)}).</li>
          {props.padNote && <li>{props.padNote}</li>}
        </ul>
        {props.running ? (
          <>
            <div className="progress indeterminate">
              <div />
            </div>
            <p className="hint">AI가 최적의 배치를 분석하고 있어요. 지도 쪽 분석 화면에서 단계를 보여 줍니다.</p>
            <button type="button" className="secondary block" onClick={props.onCancel}>
              중단
            </button>
          </>
        ) : (
          <button type="button" className="block" disabled={!props.canRun} onClick={props.onRun}>
            배치안 생성
          </button>
        )}
        {!props.canRun && <p className="hint">필지 탭에서 필지를 먼저 선택하세요.</p>}
        {props.error && <p className="error">{props.error}</p>}
      </section>

      {ordered?.map((c) => (
        <section className={c.strategy === RECOMMENDED ? 'card option recommended' : 'card option'} key={c.strategy}>
          <h2>
            {STRATEGIES[c.strategy].label}
            {c.strategy === RECOMMENDED && <span className="rv-badge ok">추천</span>}
          </h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {STRATEGIES[c.strategy].detail}
          </p>
          <div className="hero">
            {c.strategy === 'capacity' ? (
              <>
                <strong>{fmt(c.metrics.kWp, 1)}</strong> kWp · {fmt(c.metrics.annualKWh / 1000, 1)} MWh/년
              </>
            ) : (
              <>
                <strong>{fmt(c.metrics.annualKWh / 1000, 1)}</strong> MWh/년 · LCOE {fmt(c.metrics.lcoe, 1)}원/kWh
              </>
            )}
          </div>
          <dl className="facts wide">
            <dt>설비용량</dt>
            <dd>
              DC {fmt(c.metrics.kWp, 1)} kWp · AC {fmt(c.metrics.kWac)} kW ({fmt(c.metrics.modules)}장)
            </dd>
            <dt>모듈</dt>
            <dd>
              {moduleLabel(c.params)} · {fmt(c.params.moduleWatt)} W × {fmt(c.metrics.modules)}장
            </dd>
            <dt>인버터</dt>
            <dd>
              {inverterLabel(c.inverterId)} × {fmt(c.metrics.inverters)}대
            </dd>
            <dt>세트 구성</dt>
            <dd>
              {isContinuous(c.params)
                ? `연속 배열: 줄을 경계 끝까지 잇기 (기둥 한 칸 ${c.params.setCols}열 × ${c.params.setRows}단 단위)`
                : `${c.params.setCols}열 × ${c.params.setRows}단 세트 ${fmt(c.sets.length)}개`}
            </dd>
            <dt>효율</dt>
            <dd>
              {fmt(c.metrics.specificYield)} kWh/kWp (음영 {fmt(c.metrics.shadeLoss * 100, 1)}%, 클리핑 {fmt(c.metrics.clipLoss * 100, 1)}%)
            </dd>
            <dt>경사·방위</dt>
            <dd>
              {fmt(c.params.tilt, 1)}° · {c.zone ? '아래 구역별' : az(c.params.azimuth)} · {RACKING[c.params.racking].label}
            </dd>
            {c.zone && (
              <>
                <dt>배치 방식</dt>
                <dd>
                  {ZONE_LABEL[c.zone]}: {azimuthMix(c.sets).map((m) => `${az(m.azimuth)} ${fmt(m.count)}세트`).join(' · ')}
                </dd>
              </>
            )}
            <dt>열 이격·피치</dt>
            <dd>
              {fmt(c.params.rowSpacing, 2)} m · {fmt(c.params.rowSpacing + setGeometry(c.params).depth, 2)} m (
              {c.spacingRatio >= 1 ? '동지 9~15시 무음영' : `무음영 간격의 ${fmt(c.spacingRatio * 100)}%`})
            </dd>
            {c.metrics.cut !== null && (
              <>
                <dt>토공</dt>
                <dd>
                  절토 {fmt(c.metrics.cut)} ㎥ · 성토 {fmt(c.metrics.fill ?? 0)} ㎥
                </dd>
              </>
            )}
            <dt>설치비</dt>
            <dd>
              {eok(c.metrics.capex.total)}억원 ({fmt(c.metrics.capexPerKW, 1)}만원/kWp)
            </dd>
            <dt>사업 IRR</dt>
            <dd>{pct(c.metrics.projectIrr)}</dd>
          </dl>
          <button type="button" className="block" onClick={() => props.onApply(c.params, c.sets, c.zone ?? 'grid', c.rowOffset)}>
            이 배치 적용
          </button>
        </section>
      ))}
      {results && !props.running && props.extra}
      {results && results.length === 0 && (
        <section className="card">
          <p className="hint">필지에 세트가 들어갈 자리가 없습니다. 경계 이격이나 세트 크기, 설계 가능 영역 조건을 줄여 보세요.</p>
        </section>
      )}

      <section className="card">
        <h2>배치안 비교</h2>
        {rows.length ? (
          <div className="table-scroll">
            <table className="month-table compare">
              <thead>
                <tr>
                  <th>배치안</th>
                  <th>DC kWp</th>
                  <th>AC kW</th>
                  <th>MWh/년</th>
                  <th>kWh/kWp</th>
                  <th>절·성토 ㎥</th>
                  <th>CAPEX 억</th>
                  <th>LCOE 원/kWh</th>
                  <th>사업 IRR</th>
                  <th>회수(년)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.name}
                      {r.key === 'current' && props.currentBusy && <small> 계산 중</small>}
                    </td>
                    <td>{fmt(r.m.kWp, 1)}</td>
                    <td>{fmt(r.m.kWac)}</td>
                    <td className={r.m.annualKWh === bestEnergy ? 'best' : ''}>{fmt(r.m.annualKWh / 1000, 1)}</td>
                    <td>{fmt(r.m.specificYield)}</td>
                    <td>{r.m.cut === null ? '-' : `${fmt(r.m.cut)}/${fmt(r.m.fill ?? 0)}`}</td>
                    <td>{eok(r.m.capex.total)}</td>
                    <td className={r.m.lcoe === bestLcoe ? 'best' : ''}>{fmt(r.m.lcoe, 1)}</td>
                    <td>{pct(r.m.projectIrr)}</td>
                    <td>{r.m.payback === null ? '-' : fmt(r.m.payback, 1)}</td>
                    <td className="actions">
                      {r.apply && (
                        <button type="button" className="link" onClick={r.apply}>
                          적용
                        </button>
                      )}
                      {r.remove && (
                        <button type="button" className="link" onClick={r.remove}>
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">배치를 하면 현재 배치의 지표가 여기에 나옵니다.</p>
        )}
        <button type="button" className="secondary block" disabled={!props.current || props.currentBusy} onClick={props.onSaveCurrent}>
          현재 배치를 비교 목록에 저장
        </button>
        <p className="hint">
          LCOE는 설치비와 분석 기간의 운영비 현재가치를 발전량 현재가치로 나눈 값입니다. 설치비 단가와 판매·융자 조건은 경제성 탭에서
          바꿉니다. 굵은 글씨가 가장 좋은 값입니다.
        </p>
      </section>
    </>
  )
}
