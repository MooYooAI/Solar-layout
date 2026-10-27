import { useState, type ReactNode } from 'react'
import { STRATEGIES, groupCandidates, strategiesLabel, withFixed, type Candidate, type FixedSettings, type Strategy } from '../lib/optimize'
import type { DesignMetrics } from '../lib/design'
import { isContinuous, setGeometry, type LayoutParams, type ModuleSet } from '../lib/layout'
import { findModule, INVERTERS, moduleName, RACKING, type ModuleSpec, type RackingType } from '../lib/catalog'
import ModuleSelect from './ModuleSelect'
import NumberInput from './NumberInput'
import { azimuthMix, type ZoneMode } from '../lib/zones'
import { expandPlants, plantSummary, type PlantSpec } from '../lib/plants'

/** 비교 목록에 저장한 배치안 */
export interface Scenario {
  id: string
  name: string
  params: LayoutParams
  sets: ModuleSet[]
  metrics: DesignMetrics
  /** 저장할 때의 배치 방식 */
  layoutMode?: 'grid' | ZoneMode
}

interface Props {
  /** auto: 방위각·경사각·간격을 AI가 모두 찾는다. manual: 사용자가 넣은 값을 지키고 비운 칸만 찾는다. */
  mode: 'auto' | 'manual'
  onMode: (m: 'auto' | 'manual') => void
  /** 설정 배치 입력값(비운 칸은 undefined) */
  fixed: FixedSettings
  /** 기본설계 값에서 고친 적이 있는지 */
  fixedEdited: boolean
  onFixed: (f: FixedSettings) => void
  onResetFixed: () => void
  /** 기본설계 값. 설정 배치에서 모듈·구조물·지면 높이·패널 간격·경계 이격을 고치면 기본설계도 같이 바뀐다. */
  params: LayoutParams
  onParams: (p: LayoutParams) => void
  onModule: (m: ModuleSpec) => void
  /** 지금 지도에 미리보기로 띄운 안의 키. 없으면 null */
  previewKey: string | null
  /** 안을 지도에 미리보기로 띄운다(null이면 끈다). 적용과 달리 현재 배치는 그대로 둔다. */
  onPreview: (p: { key: string; name: string; params: LayoutParams; sets: ModuleSet[] } | null) => void
  canRun: boolean
  running: boolean
  results: Candidate[] | null
  error: string | null
  onRun: () => void
  onCancel: () => void
  /** mode는 다시 배치할 때 쓸 배치 방식(AI 안이 고른 방식) */
  onApply: (params: LayoutParams, sets: ModuleSet[], mode?: 'grid' | ZoneMode) => void
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
/** 추천 배치안: kW당 발전량을 지키면서 발전량이 가장 많은 균형 안 */
const RECOMMENDED: Strategy = 'balanced'
/** 보여 주는 순서: 추천(균형) 다음에 발전량 최대 */
const ORDER: Strategy[] = ['balanced', 'energy', 'capacity', 'lcoe', 'yield']
const ZONE_LABEL: Record<ZoneMode, string> = {
  edge: '구역별 방위(경계 방향)',
  half: '구역별 방위(절충)',
  fill: '한 방향 + 빈자리 채우기',
}

/** 설정 배치 입력 칸. 비우면 그 항목은 AI가 찾는다. */
function FixField(props: { label: string; unit: string; value: number | undefined; step?: number; min?: number; max?: number; onChange: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        placeholder="자동"
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        value={draft ?? props.value ?? ''}
        onChange={(e) => {
          setDraft(e.target.value)
          if (e.target.value === '') props.onChange(undefined)
          else if (!Number.isNaN(e.target.valueAsNumber)) props.onChange(e.target.valueAsNumber)
        }}
        onBlur={() => setDraft(null)}
      />
      <em>{props.unit}</em>
    </label>
  )
}

export default function OptimizePanel(props: Props) {
  const { results } = props
  const ordered = results ? groupCandidates([...results].sort((a, b) => ORDER.indexOf(a.strategy) - ORDER.indexOf(b.strategy))) : null
  const f = props.fixed
  const setF = (k: keyof FixedSettings) => (v: number | undefined) => props.onFixed({ ...f, [k]: v })
  const p = props.params
  const setP = <K extends keyof LayoutParams>(k: K) => (v: LayoutParams[K]) => props.onParams({ ...p, [k]: v })
  // 열 간격은 열 이격거리나 열 중심 간격(피치) 가운데 편한 쪽으로 넣는다. 세트 앞뒤 길이는 경사각·단 수로 정해진다.
  const [spacingPick, setSpacingBy] = useState<'gap' | 'pitch'>('gap')
  // 값이 들어 있으면 그 칸을 보여 주고, 둘 다 비었으면(AI가 찾음) 마지막으로 고른 쪽
  const spacingBy = f.pitch !== undefined ? 'pitch' : f.rowSpacing !== undefined ? 'gap' : spacingPick
  const depth = setGeometry(withFixed(p, { ...f, rowSpacing: undefined, pitch: undefined })).depth
  // 발전소 나누기(기본설계 값과 같이 바뀜)
  const plants = p.plants ?? []
  const setPlant = (i: number, patch: Partial<PlantSpec>) => setP('plants')(plants.map((pl, j) => (j === i ? { ...pl, ...patch } : pl)))
  const expanded = expandPlants(plants)
  const plantCount = expanded.length
  const plantTotal = expanded.reduce((a, pl) => a + pl.kw, 0)
  const switchSpacing = (by: 'gap' | 'pitch') => {
    if (by === spacingBy) return
    setSpacingBy(by)
    if (by === 'pitch') props.onFixed({ ...f, rowSpacing: undefined, pitch: f.rowSpacing === undefined ? undefined : Math.round((f.rowSpacing + depth) * 100) / 100 })
    else props.onFixed({ ...f, pitch: undefined, rowSpacing: f.pitch === undefined ? undefined : Math.max(0, Math.round((f.pitch - depth) * 100) / 100) })
  }
  type Row = { key: string; name: string; m: DesignMetrics; apply?: () => void; remove?: () => void }
  const rows: Row[] = [
    ...(props.current ? [{ key: 'current', name: '현재 배치', m: props.current }] : []),
    ...props.scenarios.map((s) => ({
      key: s.id,
      name: s.name,
      m: s.metrics,
      apply: () => props.onApply(s.params, s.sets, s.layoutMode),
      remove: () => props.onRemoveScenario(s.id),
    })),
    ...(ordered ?? []).map(({ strategies, c }) => ({
      key: `ai-${c.strategy}`,
      name: `AI ${strategiesLabel(strategies)}`,
      m: c.metrics,
      apply: () => props.onApply(c.params, c.sets, c.zone ?? 'grid'),
    })),
  ]
  const finite = rows.filter((r) => Number.isFinite(r.m.lcoe))
  const bestLcoe = finite.length ? Math.min(...finite.map((r) => r.m.lcoe)) : NaN
  const bestEnergy = rows.length ? Math.max(...rows.map((r) => r.m.annualKWh)) : NaN

  return (
    <>
      <section className="card">
        <h2>AI 추천 배치</h2>
        <div className="seg opt-mode" role="tablist" aria-label="배치 방식">
          <button type="button" role="tab" aria-selected={props.mode === 'auto'} onClick={() => props.onMode('auto')}>
            자동 배치
          </button>
          <button type="button" role="tab" aria-selected={props.mode === 'manual'} onClick={() => props.onMode('manual')}>
            설정 배치
          </button>
        </div>
        {props.mode === 'auto' ? (
          <p className="hint">
            방위각·경사각·열 이격거리를 AI가 모두 바꿔 보며 발전량, 설비용량, 발전원가 같은 기준마다 가장 좋은 배치안을 찾습니다. 세트 구성은 기본설계의
            가로 장수·단 수와 연속 배열을 함께 견줍니다.
          </p>
        ) : (
          <>
            <p className="hint">
              입력한 값은 AI가 바꾸지 않습니다. 그 조건에서 세트가 가장 많이 들어가도록 첫 열 위치를 맞추고, 용량에 맞는 인버터를 고릅니다. 칸을 비우면 그
              항목만 AI가 찾아 기준별 배치안을 만듭니다.
            </p>
            <h3 className="sub">AI가 지킬 값</h3>
            <p className="hint" style={{ marginTop: 4 }}>
              모듈, 구조물, 지면 높이, 패널 간격, 경계 이격은 기본설계 배치 탭과 같은 값이라 여기서 고치면 같이 바뀝니다. '자동'으로 비울 수 있는 칸은 이
              설정 배치에서만 씁니다.{' '}
              {props.fixedEdited && (
                <button type="button" className="link" onClick={props.onResetFixed}>
                  기본설계 값으로 되돌리기
                </button>
              )}
            </p>
            <div className="fix-group">
              <h3 className="sub">모듈</h3>
              <ModuleSelect params={p} onModule={props.onModule} />
              <label className="field">
                <span>배치</span>
                <select value={p.portrait ? 'p' : 'l'} onChange={(e) => setP('portrait')(e.target.value === 'p')}>
                  <option value="p">세로</option>
                  <option value="l">가로</option>
                </select>
              </label>
            </div>
            <div className="fix-group">
              <h3 className="sub">세트 구성과 설치</h3>
              <label className="field">
                <span>구조물(래킹)</span>
                <select
                  value={p.racking}
                  onChange={(e) => {
                    const r = e.target.value as RackingType
                    props.onParams({ ...p, racking: r, groundClearance: RACKING[r].groundClearance })
                  }}
                >
                  {(Object.keys(RACKING) as RackingType[]).map((k) => (
                    <option key={k} value={k}>
                      {RACKING[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid2">
                <FixField label="가로 장수" unit="장" value={f.setCols} min={1} onChange={setF('setCols')} />
                <FixField label="단 수" unit="단" value={f.setRows} min={1} max={6} onChange={setF('setRows')} />
                <FixField label="경사각" unit="°" value={f.tilt} min={0} max={60} step={0.5} onChange={setF('tilt')} />
                <FixField label="방위각" unit="°" value={f.azimuth} min={-90} max={90} onChange={setF('azimuth')} />
                <label className="field">
                  <span>지면 높이</span>
                  <NumberInput value={p.groundClearance} min={0} step={0.1} onValue={setP('groundClearance')} />
                  <em>m</em>
                </label>
              </div>
              <p className="hint">방위각은 정남 0°, 서쪽 +, 동쪽 −이고, 방위각을 정하면 구역마다 방향을 바꾸는 배치는 만들지 않습니다.</p>
            </div>
            <div className="fix-group">
              <h3 className="sub">간격</h3>
              <div className="grid2">
                <label className="field">
                  <span>패널 간격</span>
                  <NumberInput value={p.moduleGap} min={0} step={5} onValue={setP('moduleGap')} />
                  <em>mm</em>
                </label>
                <FixField label="세트 간격" unit="mm" value={f.setGap} min={0} step={10} onChange={setF('setGap')} />
                {spacingBy === 'gap' ? (
                  <FixField label="열 이격거리" unit="m" value={f.rowSpacing} min={0} step={0.1} onChange={(v) => props.onFixed({ ...f, rowSpacing: v, pitch: undefined })} />
                ) : (
                  <FixField label="열 중심 간격(피치)" unit="m" value={f.pitch} min={1} step={0.1} onChange={(v) => props.onFixed({ ...f, pitch: v, rowSpacing: undefined })} />
                )}
                <label className="field">
                  <span>경계 이격</span>
                  <NumberInput value={p.boundarySetback} min={0} step={0.5} onValue={setP('boundarySetback')} />
                  <em>m</em>
                </label>
              </div>
              <div className="seg spacing-by" role="tablist" aria-label="열 간격 입력 방식">
                <button type="button" role="tab" aria-selected={spacingBy === 'gap'} onClick={() => switchSpacing('gap')}>
                  열 이격거리로
                </button>
                <button type="button" role="tab" aria-selected={spacingBy === 'pitch'} onClick={() => switchSpacing('pitch')}>
                  열 중심 간격으로
                </button>
              </div>
              <p className="hint">
                세트 간격은 같은 열에서 옆 세트와의 거리입니다. 열 이격거리는 앞 세트 뒤끝에서 뒷 세트 앞끝까지, 열 중심 간격은 이격거리에 세트 앞뒤
                길이(지금 {fmt(depth, 2)} m)를 더한 값입니다.
                {spacingBy === 'pitch' && f.pitch !== undefined && (f.tilt !== undefined ? ` 이격거리로는 ${fmt(Math.max(0, f.pitch - depth), 2)} m입니다.` : ' 경사각을 AI가 찾으면 경사각마다 이격거리를 다시 맞춥니다.')}
              </p>
            </div>
            <div className="fix-group">
              <h3 className="sub">발전소 나누기</h3>
              {plants.length > 0 && (
                <div className="plant-rows">
                  <div className="plant-row head">
                    <span>용량(kW)</span>
                    <span>개수</span>
                    <span>간격(m)</span>
                    <span />
                  </div>
                  {plants.map((pl, i) => (
                    <div className="plant-row" key={i}>
                      <NumberInput value={pl.kw} min={1} step={10} onValue={(v) => setPlant(i, { kw: v })} aria-label={`${i + 1}번째 줄 용량(kW)`} />
                      <NumberInput value={pl.count} min={1} step={1} onValue={(v) => setPlant(i, { count: Math.max(1, Math.round(v)) })} aria-label={`${i + 1}번째 줄 개수`} />
                      <NumberInput value={pl.gap} min={0} step={0.5} onValue={(v) => setPlant(i, { gap: v })} aria-label={`${i + 1}번째 줄 간격(m)`} />
                      <button type="button" className="link" onClick={() => setP('plants')(plants.filter((_, j) => j !== i))} aria-label={`${i + 1}번째 줄 지우기`}>
                        지우기
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="secondary" onClick={() => setP('plants')([...plants, { kw: 100, count: 1, gap: plants.at(-1)?.gap ?? 3 }])}>
                + 발전소 추가
              </button>
              <p className="hint">
                {plants.length
                  ? `발전소 ${fmt(plantCount)}개, 합계 ${fmt(plantTotal)} kW로 나눕니다. `
                  : '한 부지를 여러 사업자가 나눠 쓸 때 씁니다. 예: 500 kW 1개와 100 kW 5개. '}
                용량은 발전소마다 넘지 않을 모듈 용량(DC)이고, 간격은 이웃 발전소 세트와 띄울 거리입니다(두 발전소 간격 중 큰 값). 한쪽 끝부터 발전소를 차례로
                채우고, 부지가 모자라면 뒤쪽 발전소가 작아집니다. 기본설계 배치에도 같이 적용됩니다.
              </p>
            </div>
          </>
        )}
        <ul className="hint checklist">
          <li>{props.maskActive ? '설계 가능 영역(경사·배수 제외)을 반영합니다.' : '설계 가능 영역을 반영하려면 지형 탭에서 지형을 불러오세요.'}</li>
          <li>{props.hasGrid ? '배치마다 세트 자리 토공량을 계산합니다.' : '지형을 불러오지 않아 토공량은 빠집니다.'}</li>
          <li>모듈은 기본설계에서 고른 모듈로 계산하고, 인버터는 안마다 용량에 맞춰 고릅니다(목표 DC/AC {fmt(props.dcAcRatio, 2)}).</li>
          {props.padNote && <li>{props.padNote}</li>}
          {plants.length > 0 && <li>{`발전소 ${fmt(plantCount)}개(합계 ${fmt(plantTotal)} kW)로 나눕니다. 설정 배치 탭에서 바꿉니다.`}</li>}
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

      {ordered?.map(({ strategies, c }) => (
        <section className={strategies.includes(RECOMMENDED) ? 'card option recommended' : 'card option'} key={c.strategy}>
          <h2>
            {strategiesLabel(strategies)}
            {strategies.includes(RECOMMENDED) && <span className="rv-badge ok">추천</span>}
          </h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {strategies.length >= ORDER.length
              ? props.mode === 'manual'
                ? '입력한 조건으로는 어느 기준으로 골라도 이 안이 가장 좋습니다. 안을 여러 개 견주려면 경사각이나 열 이격거리 칸을 비워 AI가 찾게 하세요.'
                : '어느 기준으로 골라도 이 안이 가장 좋습니다.'
              : strategies.length > 1
                ? `${strategies.length}개 기준에서 같은 안이 뽑혔습니다. ${STRATEGIES[c.strategy].detail}`
                : STRATEGIES[c.strategy].detail}
          </p>
          <div className="hero">
            {c.strategy === 'capacity' ? (
              <>
                <strong>{fmt(c.metrics.kWp, 1)}</strong> kWp · {fmt(c.metrics.annualKWh / 1000, 1)} MWh/년
              </>
            ) : (
              <>
                <strong>{fmt(c.metrics.annualKWh / 1000, 1)}</strong> MWh/년 · 발전원가 {fmt(c.metrics.lcoe, 1)}원/kWh
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
            {c.params.plants?.length ? (
              <>
                <dt>발전소</dt>
                <dd>
                  {plantSummary(c.sets, setGeometry(c.params), c.params)
                    .map((r) => `${r.plant + 1}번 ${fmt(r.kWp, 1)}/${fmt(r.target)} kW`)
                    .join(' · ')}
                </dd>
              </>
            ) : null}
            <dt>세트 구성</dt>
            <dd>
              {isContinuous(c.params)
                ? `연속 배열: 줄을 경계 끝까지 잇기 (기둥 한 칸 ${c.params.setCols}열 × ${c.params.setRows}단 단위)`
                : `${c.params.setCols}열 × ${c.params.setRows}단 세트 ${fmt(c.sets.length)}개`}
            </dd>
            <dt>kW당 발전량</dt>
            <dd>
              {fmt(c.metrics.specificYield)} kWh/kWp (음영 {fmt(c.metrics.shadeLoss * 100, 1)}%, 인버터 초과 {fmt(c.metrics.clipLoss * 100, 1)}%)
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
          <div className="option-actions">
            <button
              type="button"
              className="secondary"
              aria-pressed={props.previewKey === c.strategy}
              onClick={() =>
                props.onPreview(props.previewKey === c.strategy ? null : { key: c.strategy, name: `AI ${strategiesLabel(strategies)}`, params: c.params, sets: c.sets })
              }
            >
              {props.previewKey === c.strategy ? '미리보기 끄기' : '미리보기'}
            </button>
            <button type="button" onClick={() => props.onApply(c.params, c.sets, c.zone ?? 'grid')}>
              이 배치 적용
            </button>
          </div>
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
                  <th>발전원가 원/kWh</th>
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
          발전원가(LCOE)는 설치비와 분석 기간의 운영비 현재가치를 발전량 현재가치로 나눈 값입니다. 설치비 단가와 판매·융자 조건은 경제성 탭에서
          바꿉니다. 굵은 글씨가 가장 좋은 값입니다.
        </p>
      </section>
    </>
  )
}
