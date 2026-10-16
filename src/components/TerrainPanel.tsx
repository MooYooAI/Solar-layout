import type { GradingMode, TerrainResult } from '../lib/terrain'
import { pctToDeg } from '../lib/terrain'
import { CUTFILL_COLORS, CUTFILL_LABELS, SLOPE_COLORS, SLOPE_LABELS } from '../lib/terrainColors'

export type TerrainView = 'slope' | 'cutfill' | 'none'

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
          {props.busy ? '표고 불러오는 중…' : r ? '다시 분석' : '경사·절성토 분석'}
        </button>
        {!props.canRun && <p className="hint">필지 탭에서 필지를 먼저 선택하세요.</p>}
        {props.error && <p className="error">{props.error}</p>}
        <p className="hint">
          표고는 공개 지형 자료(SRTM 기반, 원자료 약 30m 간격)라 개략 검토용입니다. 인허가·시공용 토공량은 측량이나 5m DEM으로 다시
          산정해야 합니다.
        </p>
      </section>

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
