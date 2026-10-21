import type { GradingMode, TerrainResult } from '../lib/terrain'
import { pctToDeg } from '../lib/terrain'
import { CUTFILL_COLORS, CUTFILL_LABELS, SLOPE_COLORS, SLOPE_LABELS } from '../lib/terrainColors'
import type { BuildableOptions, BuildableResult } from '../lib/buildable'
import type { EarthworkResult } from '../lib/earthwork'
import { RACKING, type RackingType } from '../lib/catalog'

export type TerrainView = 'slope' | 'cutfill' | 'buildable' | 'none'

interface Props {
  canRun: boolean
  busy: boolean
  error: string | null
  result: TerrainResult | null
  mode: GradingMode
  onMode: (m: GradingMode) => void
  maxSlope: number
  onMaxSlope: (v: number) => void
  view: TerrainView
  onView: (v: TerrainView) => void
  onRun: () => void
  buildOptions: BuildableOptions
  onBuildOptions: (o: BuildableOptions) => void
  buildable: BuildableResult | null
  useMask: boolean
  onUseMask: (v: boolean) => void
  /** 현재 배치의 세트 자리 토공량(설계 지표에서) */
  earth: EarthworkResult | null
  racking: RackingType
  hasSets: boolean
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })
const dir = (deg: number) => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(deg / 45) % 8]

export default function TerrainPanel(props: Props) {
  const r = props.result
  return (
    <>
      <section className="card">
        <h2>지형 분석</h2>
        <div className="grid2">
          <label className="field">
            <span>정지 방식</span>
            <select value={props.mode} onChange={(e) => props.onMode(e.target.value as GradingMode)}>
              <option value="plane">지형 따라 경사면</option>
              <option value="flat">수평 정지</option>
            </select>
          </label>
          <label className="field">
            <span>계획면 최대 경사</span>
            <input
              type="number"
              min={0}
              step={1}
              value={props.maxSlope}
              disabled={props.mode === 'flat'}
              onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && props.onMaxSlope(e.target.valueAsNumber)}
            />
            <em>%</em>
          </label>
        </div>
        <button type="button" className="block" disabled={!props.canRun || props.busy} onClick={props.onRun}>
          {props.busy ? '표고 불러오는 중…' : r ? '다시 분석' : '지형 불러와 분석'}
        </button>
        {!props.canRun && <p className="hint">필지 탭에서 필지를 먼저 선택하세요.</p>}
        {props.error && <p className="error">{props.error}</p>}
        <p className="hint">
          표고는 공개 지형 자료(SRTM 기반, 원자료 약 30m 간격)라 개략 검토용입니다. 인허가·시공용 토공량은 측량이나 5m DEM으로 다시
          산정해야 합니다.
        </p>
      </section>

      <BuildableCard {...props} />

      {r && props.hasSets && (
        <section className="card">
          <h2>배치 토공량</h2>
          {props.earth ? (
            <>
              <dl className="facts">
                <dt>구조물</dt>
                <dd>{RACKING[props.racking].label}</dd>
                <dt>절토량</dt>
                <dd>
                  {fmt(props.earth.cut)} ㎥ (최대 {fmt(props.earth.maxCut, 2)} m)
                </dd>
                <dt>성토량</dt>
                <dd>
                  {fmt(props.earth.fill)} ㎥ (최대 {fmt(props.earth.maxFill, 2)} m)
                </dd>
                <dt>급경사 세트</dt>
                <dd>{fmt(props.earth.steepSets)} 개</dd>
              </dl>
              <p className="hint">
                세트 자리마다 지반에 평면을 맞추고, 구조물이 따라갈 수 있는 경사(남북 {RACKING[props.racking].nsSlopePct}%, 동서{' '}
                {RACKING[props.racking].ewSlopePct}%)를 넘는 기울기와 기초로 흡수하는 요철 ±{RACKING[props.racking].reveal} m를 넘는 만큼만
                깎거나 쌓는다고 계산했습니다. 구조물 방식은 AI 설계의 직접 설정에서 바꿉니다.
              </p>
            </>
          ) : (
            <p className="hint">계산 중…</p>
          )}
        </section>
      )}

      {r && (
        <>
          <section className="card">
            <h2>지형 경사</h2>
            <dl className="facts">
              <dt>표고</dt>
              <dd>
                {fmt(r.minZ, 1)} ~ {fmt(r.maxZ, 1)} m (차이 {fmt(r.maxZ - r.minZ, 1)} m)
              </dd>
              <dt>평균 경사</dt>
              <dd>
                {fmt(r.meanSlopePct, 1)} % ({fmt(pctToDeg(r.meanSlopePct), 1)}°)
              </dd>
              <dt>최대 경사</dt>
              <dd>
                {fmt(r.maxSlopePct, 1)} % ({fmt(pctToDeg(r.maxSlopePct), 1)}°)
              </dd>
              <dt>남향 비탈</dt>
              <dd>{fmt(r.southFacing * 100, 0)} %</dd>
            </dl>
            <p className={pctToDeg(r.meanSlopePct) > 15 ? 'error' : 'hint'}>
              {pctToDeg(r.meanSlopePct) > 15
                ? '평균 경사가 15°를 넘습니다. 산지 태양광 허가 기준(평균경사도 15° 이하)에 걸릴 수 있습니다.'
                : '평균 경사 15° 이하로, 산지 태양광 허가의 평균경사도 기준 안쪽입니다(참고용).'}
            </p>
            <ul className="legend">
              {SLOPE_LABELS.map((label, i) => (
                <li key={label}>
                  <i style={{ background: SLOPE_COLORS[i] }} />
                  <span>{label}</span>
                  <div className="bar">
                    <div style={{ width: `${r.slopeClasses[i] * 100}%` }} />
                  </div>
                  <b>{fmt(r.slopeClasses[i] * 100, 0)}%</b>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>절토·성토</h2>
            <dl className="facts">
              <dt>계획면</dt>
              <dd>{props.mode === 'flat' ? '수평' : `${dir(r.design.aspect)}쪽으로 ${fmt(r.design.slopePct, 1)} % 경사`}</dd>
              <dt>절토량</dt>
              <dd>{fmt(r.cut)} ㎥ (최대 깊이 {fmt(r.maxCut, 1)} m)</dd>
              <dt>성토량</dt>
              <dd>{fmt(r.fill)} ㎥ (최대 높이 {fmt(r.maxFill, 1)} m)</dd>
              <dt>차이</dt>
              <dd>
                {Math.abs(r.cut - r.fill) < 1
                  ? '절토·성토 균형'
                  : `${fmt(Math.abs(r.cut - r.fill))} ㎥ ${r.cut > r.fill ? '사토(반출)' : '반입'}`}
              </dd>
            </dl>
            <p className="hint">계획면 높이는 절토량과 성토량이 같아지도록 맞췄습니다.</p>
            <ul className="legend compact">
              {CUTFILL_LABELS.map((label, i) => (
                <li key={label}>
                  <i style={{ background: CUTFILL_COLORS[i] }} />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>지도 표시</h2>
            <div className="row">
              {(
                [
                  ['slope', '경사도'],
                  ['cutfill', '절성토'],
                  ['buildable', '설계 가능 영역'],
                  ['none', '끄기'],
                ] as const
              ).map(([v, label]) => (
                <label key={v}>
                  <input type="radio" checked={props.view === v} onChange={() => props.onView(v)} /> {label}
                </label>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  )
}

function BuildableCard(props: Props) {
  const o = props.buildOptions
  const b = props.buildable
  const set = <K extends keyof BuildableOptions>(k: K, v: BuildableOptions[K]) => props.onBuildOptions({ ...o, [k]: v })
  const num = (k: 'maxSlopePct' | 'drainAreaM2' | 'drainBuffer', label: string, unit: string, step: number, disabled = false) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={o[k]}
        disabled={disabled}
        onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && set(k, e.target.valueAsNumber)}
      />
      <em>{unit}</em>
    </label>
  )
  return (
    <section className="card">
      <h2>설계 가능 영역</h2>
      <div className="grid2">
        {num('maxSlopePct', '최대 경사', '%', 1)}
        <label className="field">
          <span>배수 경로</span>
          <select value={o.drainage ? 'on' : 'off'} onChange={(e) => set('drainage', e.target.value === 'on')}>
            <option value="on">제외</option>
            <option value="off">무시</option>
          </select>
        </label>
        {num('drainAreaM2', '물길 집수면적', '㎡', 500, !o.drainage)}
        {num('drainBuffer', '물길 양쪽 이격', 'm', 0.5, !o.drainage)}
      </div>
      {b ? (
        <>
          <dl className="facts wide" style={{ marginTop: 10 }}>
            <dt>부지</dt>
            <dd>{fmt(b.siteArea)} ㎡</dd>
            <dt>설계 가능</dt>
            <dd>
              <strong>{fmt(b.buildableArea)} ㎡</strong> ({fmt((100 * b.buildableArea) / Math.max(1, b.siteArea), 0)}%)
            </dd>
            <dt>경사 제외</dt>
            <dd>{fmt(b.slopeArea)} ㎡</dd>
            <dt>배수 제외</dt>
            <dd>{fmt(b.drainArea)} ㎡</dd>
          </dl>
          <label className="row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={props.useMask} onChange={(e) => props.onUseMask(e.target.checked)} /> 자동 배치와 AI 설계에
            반영
          </label>
          <ul className="legend compact">
            <li>
              <i style={{ background: 'rgba(201, 42, 42, 0.5)' }} />
              <span>경사 제외</span>
            </li>
            <li>
              <i style={{ background: 'rgba(25, 113, 194, 0.55)' }} />
              <span>배수 경로·이격</span>
            </li>
          </ul>
        </>
      ) : (
        <p className="hint">지형을 불러오면 경사 한도를 넘는 곳과 물길 주변을 빼고 배치할 수 있는 땅을 계산합니다.</p>
      )}
      <p className="hint">
        물길은 표고에서 물이 가장 가파른 쪽으로 흐른다고 보고(D8), 위쪽에서 모여드는 면적이 기준을 넘는 곳입니다. 공개 표고 자료가
        약 30m 간격이라 작은 도랑은 잡히지 않습니다.
      </p>
    </section>
  )
}
