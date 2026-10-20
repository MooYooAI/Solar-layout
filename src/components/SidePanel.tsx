import { useMemo, useState } from 'react'
import PlanEditor from './PlanEditor'
import Plan3D from './Plan3D'
import ZoomFrame from './ZoomFrame'
import DetailDrawings from './DetailDrawings'
import { LocalFrame } from '../lib/geo'
import type { MapTool } from './MapView'
import type { LayoutParams, LayoutStats, ModuleSet, SetGeometry } from '../lib/layout'
import type { Parcel } from '../lib/parcel'
import type { Obstacle } from '../lib/shading'
import type { ElecParams, ElecResult } from '../lib/electrical'
import { buildSld, sldToSvg } from '../lib/export/sld'

interface Props {
  parcel: Parcel | null
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  stats: LayoutStats
  obstacles: Obstacle[]
  selected: ReadonlySet<string>
  tool: MapTool
  onTool: (t: MapTool) => void
  elec: ElecResult | null
  elecParams: ElecParams
  designBusy: boolean
  onSelect: (ids: string[], additive: boolean) => void
  onMoveSets: (moved: Array<{ id: string; lon: number; lat: number }>) => void
  onAddSet: (lon: number, lat: number) => void
  onAutoLayout: () => void
  onDeleteSelected: () => void
  onRotateSelected: (deg: number) => void
  onClear: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** 돌아갈 작업 기록이 있는지(타임라인은 상단 바에 있다) */
  hasTimeline: boolean
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

/** 오른쪽 작업면: 가배치 도면을 보고 바로 고치는 곳, 전기 설계가 끝나면 단선결선도도 본다. */
export default function SidePanel(props: Props) {
  const { parcel, stats, tool, onTool, selected } = props
  const [view, setView] = useState<'plan' | 'side' | 'sld'>('plan')
  const [plan3d, setPlan3d] = useState(false)
  const n = selected.size
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

      {view === 'plan' ? (
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
                tool={tool}
                elec={props.elec}
                onSelect={props.onSelect}
                onMoveSets={props.onMoveSets}
                onAddSet={props.onAddSet}
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

          <div className="toolbar" role="toolbar" aria-label="배치 편집">
            <button type="button" className="primary" disabled={!parcel} onClick={props.onAutoLayout}>
              자동 배치
            </button>
            <button type="button" className={tool === 'select' ? 'toggle on' : 'toggle'} disabled={!parcel} onClick={() => onTool(tool === 'select' ? 'none' : 'select')}>
              지도에서 선택
            </button>
            <button type="button" className={tool === 'add' ? 'toggle on' : 'toggle'} disabled={!parcel} onClick={() => onTool(tool === 'add' ? 'none' : 'add')}>
              세트 추가
            </button>
          </div>
          <div className="toolbar" role="toolbar" aria-label="선택한 세트">
            <button type="button" className="ghost" disabled={!n} onClick={() => props.onRotateSelected(-5)} title="반시계 5°">
              ⟲ 5°
            </button>
            <button type="button" className="ghost" disabled={!n} onClick={() => props.onRotateSelected(5)} title="시계 5°">
              ⟳ 5°
            </button>
            <button type="button" className="ghost" disabled={!n} onClick={props.onDeleteSelected}>
              삭제{n > 0 && ` ${n}`}
            </button>
            <span className="toolbar-sep" />
            <button type="button" className="ghost icon" disabled={!props.canUndo} onClick={props.onUndo} title="되돌리기 (Ctrl+Z)" aria-label="되돌리기">
              ↶
            </button>
            <button type="button" className="ghost icon" disabled={!props.canRedo} onClick={props.onRedo} title="다시실행 (Ctrl+Shift+Z)" aria-label="다시실행">
              ↷
            </button>
            <button type="button" className="ghost danger" disabled={!stats.sets} onClick={props.onClear}>
              전체 지우기
            </button>
          </div>
          <p className="hint">
            {plan3d
              ? '3D는 보기 전용입니다. 끌어서 돌리고 휠이나 +/−로 확대합니다. 세트 편집은 2D에서 합니다.'
              : tool === 'add'
              ? '도면이나 지도를 클릭한 자리에 세트가 놓입니다.'
              : tool === 'select'
                ? '지도에서도 세트를 끌어 옮길 수 있습니다. Shift+드래그로 영역 선택.'
                : '도면에서 세트를 끌어 옮기고, Shift+클릭으로 여러 개를 고릅니다. 화살표 키로 10 cm(Shift는 1 m)씩 움직이고 Delete로 지웁니다.'}
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
