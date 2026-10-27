import { useMemo, useState } from 'react'
import PlanEditor from './PlanEditor'
import Plan3D from './Plan3D'
import ZoomFrame from './ZoomFrame'
import DetailDrawings from './DetailDrawings'
import Overview, { type OverviewStep } from './Overview'
import { plantSummary } from '../lib/plants'
import { LocalFrame } from '../lib/geo'
import type { LayoutParams, LayoutStats, ModuleSet, SetGeometry } from '../lib/layout'
import type { Parcel } from '../lib/parcel'
import type { Obstacle } from '../lib/shading'
import type { ElecParams, ElecResult } from '../lib/electrical'
import { buildSld, sldToSvg } from '../lib/export/sld'
import type { EnergyResult } from '../lib/energy'
import type { EconSettings } from './EconomicsPanel'

interface Props {
  parcel: Parcel | null
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  stats: LayoutStats
  obstacles: Obstacle[]
  selected: ReadonlySet<string>
  elec: ElecResult | null
  elecParams: ElecParams
  designBusy: boolean
  /** 돌아갈 작업 기록이 있는지(타임라인은 상단 바에 있다) */
  hasTimeline: boolean
  /** 개요 보기에 쓰는 값 */
  area: number
  zoning: string[]
  /** 설치 장소 이름(토지·건물·복합) */
  siteKind: string
  /** 비워 둔 수배전반·전기실 자리 이름 */
  padLabel: string | null
  energy: EnergyResult | null
  econ: EconSettings
  econHours: number
  steps: OverviewStep[]
  onGoStep: (key: string) => void
}

const NOOP = () => {}
const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

/** 오른쪽 보기: 개요, 보기 전용 배치도, 상세도, 단선결선도. 배치 편집은 가운데 작업면에서 한다. */
export default function SidePanel(props: Props) {
  const { parcel, stats, selected } = props
  const [view, setView] = useState<'overview' | 'plan' | 'side' | 'sld'>('overview')
  const [plan3d, setPlan3d] = useState(false)
  const sld = useMemo(
    () =>
      view === 'sld' && props.elec
        ? sldToSvg(buildSld(props.elec, props.elecParams, { title: parcel?.address ?? '', moduleWatt: props.params.moduleWatt, date: '' }), false)
        : null,
    [view, props.elec, props.elecParams, parcel, props.params.moduleWatt],
  )

  return (
    <div className="side-inner">
      <div className="side-head">
        <div className="seg" role="tablist" aria-label="오른쪽 보기">
          <button type="button" role="tab" aria-selected={view === 'overview'} onClick={() => setView('overview')}>
            개요
          </button>
          <button type="button" role="tab" aria-selected={view === 'plan'} onClick={() => setView('plan')}>
            배치도
          </button>
          <button type="button" role="tab" aria-selected={view === 'side'} onClick={() => setView('side')}>
            상세도
          </button>
          <button type="button" role="tab" aria-selected={view === 'sld'} onClick={() => setView('sld')}>
            결선도
          </button>
        </div>
      </div>

      <dl className="kpis">
        <div>
          <dt>설비용량</dt>
          <dd>
            {fmt(stats.kWp, 1)}
            <small>kWp</small>
          </dd>
        </div>
        <div>
          <dt>모듈</dt>
          <dd>
            {fmt(stats.modules)}
            <small>장</small>
          </dd>
        </div>
        <div>
          <dt>세트</dt>
          <dd>
            {fmt(stats.sets)}
            <small>개</small>
          </dd>
        </div>
        <div>
          <dt>점유율</dt>
          <dd>
            {fmt(stats.coverage * 100, 1)}
            <small>%</small>
          </dd>
        </div>
      </dl>

      {view === 'overview' ? (
        <Overview
          parcel={parcel}
          area={props.area}
          zoning={props.zoning}
          siteKind={props.siteKind}
          params={props.params}
          stats={stats}
          energy={props.energy}
          elec={props.elec}
          elecParams={props.elecParams}
          padLabel={props.padLabel}
          plants={plantSummary(props.sets, props.geometry, props.params)}
          econ={props.econ}
          econHours={props.econHours}
          steps={props.steps}
          onGo={props.onGoStep}
        />
      ) : view === 'plan' ? (
        <>
          <div className="drawing">
            {parcel && (
              <div className="seg plan-dim" role="tablist" aria-label="배치도 보기">
                <button type="button" role="tab" aria-selected={!plan3d} onClick={() => setPlan3d(false)}>
                  2D
                </button>
                <button type="button" role="tab" aria-selected={plan3d} onClick={() => setPlan3d(true)}>
                  3D
                </button>
              </div>
            )}
            {parcel && plan3d ? (
              <Plan3D
                parcel={parcel}
                sets={props.sets}
                params={props.params}
                geometry={props.geometry}
                obstacles={props.obstacles}
                selected={selected}
                elec={props.elec}
              />
            ) : parcel ? (
              <PlanEditor
                parcel={parcel}
                sets={props.sets}
                params={props.params}
                geometry={props.geometry}
                obstacles={props.obstacles}
                selected={selected}
                tool="none"
                elec={props.elec}
                onSelect={NOOP}
                onMoveSets={NOOP}
                onAddSet={NOOP}
                readOnly
              />
            ) : (
              <p className="empty">
                필지를 고르거나 영역을 그리면 여기에 배치도가 그려집니다.
                {props.hasTimeline && (
                  <>
                    <br />
                    이전 작업은 맨 위 타임라인이나 불러오기에서 이어 할 수 있습니다.
                  </>
                )}
              </p>
            )}
          </div>

          <p className="hint">
            {plan3d
              ? '3D는 끌어서 돌리고 휠이나 +/−로 확대합니다.'
              : '보기 전용입니다. 휠로 확대하고 끌어서 옮깁니다. 배치는 기본설계의 지도와 배치 편집에서 고칩니다.'}
          </p>
        </>
      ) : view === 'side' ? (
        <DetailDrawings
          params={props.params}
          geometry={props.geometry}
          lat={parcel ? LocalFrame.around(parcel.rings).lat0 : 36.5}
          elec={props.elec}
          elecParams={props.elecParams}
        />
      ) : (
        <div className="drawing sld">
          {props.elec ? (
            // 우리가 만든 SVG 문자열만 넣는다
            <ZoomFrame title="단선결선도">
              <div className="sld-preview" dangerouslySetInnerHTML={{ __html: sld ?? '' }} />
            </ZoomFrame>
          ) : (
            <p className="empty">{props.designBusy ? '전기 설계를 계산하는 중입니다.' : '세트를 배치하면 스트링·인버터 구성으로 단선결선도를 그립니다.'}</p>
          )}
        </div>
      )}
    </div>
  )
}
