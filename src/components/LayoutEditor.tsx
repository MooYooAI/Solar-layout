import { useMemo, useState } from 'react'
import PlanEditor from './PlanEditor'
import { LocalFrame } from '../lib/geo'
import type { MapTool } from './MapView'
import type { LayoutParams, LayoutStats, ModuleSet, SetGeometry } from '../lib/layout'
import type { Parcel } from '../lib/parcel'
import type { Obstacle } from '../lib/shading'
import type { ElecResult } from '../lib/electrical'

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
  onSelect: (ids: string[], additive: boolean) => void
  onMoveSets: (moved: Array<{ id: string; lon: number; lat: number }>) => void
  onAddSet: (lon: number, lat: number) => void
  onAutoLayout: () => void
  onDeleteSelected: () => void
  onRotateSelected: (deg: number) => void
  onSetAzimuth: (deg: number) => void
  onDuplicate: (dx: number, dy: number) => void
  onClear: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onPadMove?: (lon: number, lat: number) => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const az = (a: number) => (Math.abs(a) < 0.05 ? '정남' : `${a > 0 ? '서' : '동'} ${fmt(Math.abs(a), 1)}°`)
const STEPS = [0.1, 0.5, 1, 5]

/** 지도 대신 배치도를 크게 띄워 세트를 고치는 화면. 도구는 위 막대에 모은다. */
export default function LayoutEditor(props: Props) {
  const { parcel, sets, selected, tool, onTool, geometry, params } = props
  const [step, setStep] = useState(1)
  const n = selected.size
  const picked = useMemo(() => sets.filter((s) => selected.has(s.id)), [sets, selected])
  const frame = useMemo(() => (parcel ? LocalFrame.around(parcel.rings) : null), [parcel])
  const pickedAz = picked.length && picked.every((s) => s.azimuth === picked[0].azimuth) ? picked[0].azimuth : null

  /** 선택한 세트를 동(+x)·북(+y)으로 m만큼 옮긴다. */
  const nudge = (dx: number, dy: number) => {
    if (!frame || !picked.length) return
    props.onMoveSets(
      picked.map((s) => {
        const [x, y] = frame.toLocal([s.lon, s.lat])
        const [lon, lat] = frame.toLonLat([x + dx, y + dy])
        return { id: s.id, lon, lat }
      }),
    )
  }
  const setGapM = params.setGap / 1000
  const pitch = geometry.depth + params.rowSpacing

  if (!parcel)
    return (
      <div className="editor">
        <p className="editor-empty">필지를 고르거나 영역을 그리면 여기서 배치를 편집할 수 있습니다.</p>
      </div>
    )

  return (
    <div className="editor">
      <div className="editor-bar" role="toolbar" aria-label="배치 편집 도구">
        <div className="tool-group" aria-label="모드">
          <span className="tool-label">모드</span>
          <button type="button" className={tool !== 'add' ? 'toggle on' : 'toggle'} onClick={() => onTool('none')} title="세트를 눌러 고르고 끌어 옮깁니다">
            ↖ 선택·이동
          </button>
          <button type="button" className={tool === 'add' ? 'toggle on' : 'toggle'} onClick={() => onTool(tool === 'add' ? 'none' : 'add')} title="도면을 누른 자리에 세트를 놓습니다">
            ＋ 세트 추가
          </button>
        </div>

        <div className="tool-group" aria-label="선택">
          <span className="tool-label">선택</span>
          <button type="button" className="ghost" disabled={!sets.length} onClick={() => props.onSelect(sets.map((s) => s.id), false)} title="전체 선택 (Ctrl+A)">
            전체
          </button>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onSelect([], false)} title="선택 해제 (Esc)">
            해제
          </button>
        </div>

        <div className="tool-group" aria-label="회전">
          <span className="tool-label">회전</span>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onRotateSelected(-5)} title="반시계 5°">
            ⟲5°
          </button>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onRotateSelected(-1)} title="반시계 1°">
            ⟲1°
          </button>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onRotateSelected(1)} title="시계 1°">
            ⟳1°
          </button>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onRotateSelected(5)} title="시계 5°">
            ⟳5°
          </button>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onSetAzimuth(params.azimuth)} title={`직접 설정 방위각(${az(params.azimuth)})으로 맞춥니다`}>
            방위 맞춤
          </button>
        </div>

        <div className="tool-group" aria-label="복제">
          <span className="tool-label">복제</span>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onDuplicate(geometry.width + setGapM, 0)} title="옆(동쪽)에 세트 간격만큼 띄워 복제 (Ctrl+D)">
            옆으로
          </button>
          <button type="button" className="ghost" disabled={!n} onClick={() => props.onDuplicate(0, pitch)} title="뒷열(북쪽)에 열 피치만큼 띄워 복제">
            뒷열로
          </button>
        </div>

        <div className="tool-group" aria-label="편집">
          <button type="button" className="ghost icon" disabled={!props.canUndo} onClick={props.onUndo} title="되돌리기 (Ctrl+Z)" aria-label="되돌리기">
            ↶
          </button>
          <button type="button" className="ghost icon" disabled={!props.canRedo} onClick={props.onRedo} title="다시실행 (Ctrl+Shift+Z)" aria-label="다시실행">
            ↷
          </button>
          <button type="button" className="ghost danger" disabled={!n} onClick={props.onDeleteSelected} title="선택 삭제 (Delete)">
            삭제{n > 0 && ` ${n}`}
          </button>
          <button type="button" className="ghost danger" disabled={!sets.length} onClick={props.onClear}>
            전체 지우기
          </button>
        </div>

        <button type="button" className="editor-auto" onClick={props.onAutoLayout}>
          {sets.length ? '수정값 반영 다시 배치' : '이 설정으로 배치'}
        </button>
      </div>

      <div className="editor-body">
        <div className="editor-canvas">
          <PlanEditor
            parcel={parcel}
            sets={sets}
            params={params}
            geometry={geometry}
            obstacles={props.obstacles}
            selected={selected}
            tool={tool}
            elec={props.elec}
            onSelect={props.onSelect}
            onMoveSets={props.onMoveSets}
            onAddSet={props.onAddSet}
            onPadMove={props.onPadMove}
          />
        </div>

        <aside className="editor-inspector" aria-label="선택한 세트">
          <h3>{n ? `선택 ${fmt(n)}세트` : '선택 없음'}</h3>
          {n ? (
            <dl className="facts">
              <dt>모듈</dt>
              <dd>{fmt(n * geometry.modules)}장</dd>
              <dt>용량</dt>
              <dd>{fmt((n * geometry.watt) / 1000, 1)} kWp</dd>
              <dt>방위</dt>
              <dd>{pickedAz === null ? '여러 방향' : az(pickedAz)}</dd>
            </dl>
          ) : (
            <p className="hint">세트를 누르거나 Shift+드래그로 여러 개를 고르세요.</p>
          )}

          <h3>미세 이동</h3>
          <div className="seg step-seg" role="radiogroup" aria-label="이동 간격">
            {STEPS.map((s) => (
              <button key={s} type="button" role="radio" aria-selected={step === s} aria-checked={step === s} onClick={() => setStep(s)}>
                {s} m
              </button>
            ))}
          </div>
          <div className="nudge" aria-label="선택한 세트 이동">
            <span />
            <button type="button" className="outline" disabled={!n} onClick={() => nudge(0, step)} aria-label={`북쪽으로 ${step} m`}>
              ↑
            </button>
            <span />
            <button type="button" className="outline" disabled={!n} onClick={() => nudge(-step, 0)} aria-label={`서쪽으로 ${step} m`}>
              ←
            </button>
            <span className="nudge-n">N</span>
            <button type="button" className="outline" disabled={!n} onClick={() => nudge(step, 0)} aria-label={`동쪽으로 ${step} m`}>
              →
            </button>
            <span />
            <button type="button" className="outline" disabled={!n} onClick={() => nudge(0, -step)} aria-label={`남쪽으로 ${step} m`}>
              ↓
            </button>
            <span />
          </div>

          <h3>전체</h3>
          <dl className="facts">
            <dt>세트</dt>
            <dd>{fmt(props.stats.sets)}개</dd>
            <dt>모듈</dt>
            <dd>{fmt(props.stats.modules)}장</dd>
            <dt>설비용량</dt>
            <dd>{fmt(props.stats.kWp, 1)} kWp</dd>
          </dl>

          <details className="shortcuts">
            <summary>단축키</summary>
            <ul>
              <li><kbd>드래그</kbd> 세트 이동 · 빈 곳은 화면 이동</li>
              <li><kbd>Shift</kbd>+클릭/드래그 여러 개 선택</li>
              <li><kbd>←↑→↓</kbd> 10 cm, <kbd>Shift</kbd> 1 m 이동</li>
              <li><kbd>Ctrl+A</kbd> 전체 선택 · <kbd>Ctrl+D</kbd> 복제</li>
              <li><kbd>Delete</kbd> 삭제 · <kbd>Ctrl+Z</kbd> 되돌리기</li>
              <li><kbd>휠</kbd> 확대·축소</li>
            </ul>
          </details>
        </aside>
      </div>
    </div>
  )
}
