import type { LayoutParams, LayoutStats } from '../lib/layout'
import type { MapTool } from './MapView'

interface Props {
  params: LayoutParams
  onParams: (p: LayoutParams) => void
  suggestedRowSpacing: number | null
  stats: LayoutStats
  canLayout: boolean
  tool: MapTool
  onTool: (t: MapTool) => void
  selectedCount: number
  onAutoLayout: () => void
  onDeleteSelected: () => void
  onRotateSelected: (deg: number) => void
  onClear: () => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

function Field(props: {
  label: string
  unit: string
  value: number
  step?: number
  min?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        step={props.step ?? 1}
        min={props.min ?? 0}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          if (!Number.isNaN(v)) props.onChange(v)
        }}
      />
      <em>{props.unit}</em>
    </label>
  )
}

export default function LayoutPanel(props: Props) {
  const { params: p, onParams, stats, tool, onTool, selectedCount } = props
  const set = <K extends keyof LayoutParams>(k: K) => (v: LayoutParams[K]) => onParams({ ...p, [k]: v })

  return (
    <>
      <section className="card">
        <h2>모듈</h2>
        <div className="grid2">
          <Field label="긴 변" unit="mm" value={p.moduleLength} onChange={set('moduleLength')} />
          <Field label="짧은 변" unit="mm" value={p.moduleWidth} onChange={set('moduleWidth')} />
          <Field label="출력" unit="W" value={p.moduleWatt} step={5} onChange={set('moduleWatt')} />
          <label className="field">
            <span>배치</span>
            <select value={p.portrait ? 'p' : 'l'} onChange={(e) => set('portrait')(e.target.value === 'p')}>
              <option value="p">세로</option>
              <option value="l">가로</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>세트 구성과 설치</h2>
        <div className="grid2">
          <Field label="가로 장수" unit="장" value={p.setCols} min={1} onChange={set('setCols')} />
          <Field label="단 수" unit="단" value={p.setRows} min={1} onChange={set('setRows')} />
          <Field label="경사각" unit="°" value={p.tilt} min={0} onChange={set('tilt')} />
          <Field label="방위각" unit="°" value={p.azimuth} min={-90} onChange={set('azimuth')} />
          <Field label="지면 높이" unit="m" value={p.groundClearance} step={0.1} onChange={set('groundClearance')} />
        </div>
        <p className="hint">방위각은 정남 0°, 서쪽 +, 동쪽 −입니다.</p>
      </section>

      <section className="card">
        <h2>간격</h2>
        <div className="grid2">
          <Field label="패널 간격" unit="mm" value={p.moduleGap} step={5} onChange={set('moduleGap')} />
          <Field label="세트 간격" unit="mm" value={p.setGap} step={50} onChange={set('setGap')} />
          <Field label="열 이격거리" unit="m" value={p.rowSpacing} step={0.1} onChange={set('rowSpacing')} />
          <Field label="경계 이격" unit="m" value={p.boundarySetback} step={0.1} onChange={set('boundarySetback')} />
        </div>
        {props.suggestedRowSpacing !== null && (
          <p className="hint">
            동지 9~15시에 앞 열 그림자가 닿지 않으려면 열 이격거리 {fmt(props.suggestedRowSpacing, 2)} m 이상이 필요합니다.{' '}
            <button type="button" className="link" onClick={() => set('rowSpacing')(Math.ceil(props.suggestedRowSpacing! * 10) / 10)}>
              적용
            </button>
          </p>
        )}
        <p className="hint">세트 간격은 같은 열에서 옆 세트와의 거리, 열 이격거리는 앞 세트 뒤끝부터 뒷 세트 앞끝까지입니다.</p>
        <button type="button" className="block" disabled={!props.canLayout} onClick={props.onAutoLayout}>
          자동 배치
        </button>
        {!props.canLayout && <p className="hint">먼저 필지 탭에서 필지를 선택하세요.</p>}
      </section>

      <section className="card">
        <h2>수동 편집</h2>
        <div className="row">
          <button type="button" className={tool === 'select' ? '' : 'secondary'} onClick={() => onTool(tool === 'select' ? 'none' : 'select')}>
            선택·이동
          </button>
          <button type="button" className={tool === 'add' ? '' : 'secondary'} onClick={() => onTool(tool === 'add' ? 'none' : 'add')}>
            세트 추가
          </button>
        </div>
        {tool === 'select' && (
          <p className="hint">세트를 클릭해 고르고 끌어서 옮깁니다. Shift+클릭으로 추가 선택, Shift+드래그로 영역 선택, Delete 키로 삭제합니다.</p>
        )}
        {tool === 'add' && <p className="hint">지도를 클릭한 자리에 세트가 놓입니다.</p>}
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="secondary" disabled={!selectedCount} onClick={() => props.onRotateSelected(-5)}>
            ⟲ 5°
          </button>
          <button type="button" className="secondary" disabled={!selectedCount} onClick={() => props.onRotateSelected(5)}>
            ⟳ 5°
          </button>
          <button type="button" className="secondary" disabled={!selectedCount} onClick={props.onDeleteSelected}>
            선택 삭제 {selectedCount > 0 && `(${selectedCount})`}
          </button>
          <button type="button" className="secondary" disabled={!stats.sets} onClick={props.onClear}>
            전체 지우기
          </button>
        </div>
      </section>

      <section className="card">
        <h2>배치 결과</h2>
        <dl className="facts">
          <dt>세트</dt>
          <dd>{fmt(stats.sets)} 개</dd>
          <dt>모듈</dt>
          <dd>{fmt(stats.modules)} 장</dd>
          <dt>설비용량</dt>
          <dd>{fmt(stats.kWp, 2)} kWp</dd>
          <dt>점유율</dt>
          <dd>{fmt(stats.coverage * 100, 1)} %</dd>
        </dl>
      </section>
    </>
  )
}
