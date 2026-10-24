import { continuousParams, isContinuous, type LayoutParams, type SetGeometry } from '../lib/layout'
import { MODULES, RACKING, findModule, type ModuleSpec, type RackingType } from '../lib/catalog'
import type { ZoneMode } from '../lib/zones'

interface Props {
  params: LayoutParams
  onParams: (p: LayoutParams) => void
  suggestedRowSpacing: number | null
  canLayout: boolean
  onAutoLayout: () => void
  geometry: SetGeometry
  onModule: (m: ModuleSpec) => void
  /** 설계 가능 영역을 자동 배치에 반영 중인지 */
  maskActive: boolean
  layoutMode: LayoutMode
  onLayoutMode: (m: LayoutMode) => void
  /** 전기실 자리 비워 두기. label은 자리를 찾았을 때 그 이름 */
  pad: {
    on: boolean
    label: string | null
    /** 전기실을 둘지 고른 근거(용량 기준) 한 줄 */
    rule: string
    onToggle: (on: boolean) => void
    /** 최적 자리 찾기 진행·결과 한 줄 */
    status: string | null
    busy: boolean
    /** 기본 자리에서 옮겼는지 */
    moved: boolean
    onFind: () => void
    onReset: () => void
  }
  /** 변마다 따로 정하는 경계 이격 */
  edges: {
    /** 지도에서 변을 고르는 중인지 */
    picking: boolean
    onPick: () => void
    /** 고른 변의 길이(m)와 따로 정한 이격(없으면 null) */
    selected: { length: number; m: number | null } | null
    onSet: (m: number | null) => void
    /** 이격을 따로 정한 변 수 */
    count: number
    onClear: () => void
  }
}

/** 자동 배치 방식: 한 방향 격자, 또는 구역별 방위각(zones.ts) */
export type LayoutMode = 'grid' | ZoneMode

const LAYOUT_MODES: Array<[LayoutMode, string]> = [
  ['grid', '한 방향'],
  ['fill', '한 방향 + 빈자리 채우기'],
  ['edge', '구역별 방위(경계 방향)'],
  ['half', '구역별 방위(절충)'],
]

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

/** 모듈 목록을 제조사별로 묶는다. 일반 규격이 먼저 */
const GENERIC = '일반 규격'
/** 제조사 제품(목록 순서, 국산 먼저)을 위에, 일반 규격을 맨 아래에 */
const MODULE_GROUPS: Array<[string, ModuleSpec[]]> = [
  ...new Set([...MODULES.flatMap((m) => (m.maker ? [m.maker] : [])), GENERIC]),
].map((maker) => [maker, MODULES.filter((m) => (m.maker ?? GENERIC) === maker)])

export default function LayoutPanel(props: Props) {
  const { params: p, onParams } = props
  const set = <K extends keyof LayoutParams>(k: K) => (v: LayoutParams[K]) => onParams({ ...p, [k]: v })
  const preset = findModule(p.moduleLength, p.moduleWidth, p.moduleWatt)
  const pitch = props.geometry.depth + p.rowSpacing

  return (
    <>
      <section className="card">
        <h2>모듈</h2>
        <label className="field" style={{ marginBottom: 8 }}>
          <span>모듈 종류</span>
          <select
            value={preset?.id ?? 'custom'}
            onChange={(e) => {
              const m = MODULES.find((x) => x.id === e.target.value)
              if (m) props.onModule(m)
            }}
          >
            {MODULE_GROUPS.map(([maker, list]) => (
              <optgroup key={maker} label={maker}>
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.maker ? `${m.model} · ${m.label}` : m.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="custom" disabled>
              직접 입력
            </option>
          </select>
        </label>
        {preset?.maker && (
          <p className="hint" style={{ marginTop: 0 }}>
            {preset.estimated
              ? `${preset.maker} ${preset.model}: 공개 데이터시트가 없어 같은 시리즈 값으로 어림한 전기 값(Voc ${preset.voc} V, Isc ${preset.isc} A)으로 스트링을 짭니다. 발주 전에 납품 데이터시트로 확인하세요.`
              : `${preset.maker} ${preset.model}: 데이터시트 STC 값(Voc ${preset.voc} V, Isc ${preset.isc} A)으로 스트링을 짭니다.`}
          </p>
        )}
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
        <label className="field" style={{ marginBottom: 8 }}>
          <span>구조물(래킹)</span>
          <select
            value={p.racking}
            onChange={(e) => {
              const r = e.target.value as RackingType
              onParams({ ...p, racking: r, groundClearance: RACKING[r].groundClearance })
            }}
          >
            {(Object.keys(RACKING) as RackingType[]).map((k) => (
              <option key={k} value={k}>
                {RACKING[k].label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          {RACKING[p.racking].detail}
        </p>
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
          <Field
            label="피치(열 중심 간격)"
            unit="m"
            value={Math.round(pitch * 100) / 100}
            step={0.1}
            min={props.geometry.depth}
            onChange={(v) => set('rowSpacing')(Math.max(0, Math.round((v - props.geometry.depth) * 100) / 100))}
          />
          <label className="field">
            <span>지면 피복률(GCR)</span>
            <input value={pitch > 0 ? `${((props.geometry.slope / pitch) * 100).toFixed(0)} %` : '-'} readOnly />
          </label>
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
        <div className="edge-tools">
          <div className="row">
            <button type="button" className={props.edges.picking ? '' : 'secondary'} disabled={!props.canLayout} onClick={props.edges.onPick}>
              {props.edges.picking ? '변 고르기 끝' : '변마다 경계 이격 정하기'}
            </button>
            {props.edges.count > 0 && (
              <button type="button" className="link" onClick={props.edges.onClear}>
                모두 지우기
              </button>
            )}
          </div>
          {props.edges.picking && !props.edges.selected && <p className="hint">지도에서 이격을 따로 줄 경계 변을 클릭하세요.</p>}
          {props.edges.selected && (
            <div className="edge-pick">
              <Field
                label={`고른 변 (길이 ${fmt(props.edges.selected.length, 1)} m)`}
                unit="m"
                value={props.edges.selected.m ?? p.boundarySetback}
                step={0.5}
                onChange={(v) => props.edges.onSet(v)}
              />
              {props.edges.selected.m !== null && (
                <button type="button" className="link" onClick={() => props.edges.onSet(null)}>
                  경계 이격({fmt(p.boundarySetback, 1)} m)으로 되돌리기
                </button>
              )}
            </div>
          )}
          <p className="hint">
            {props.edges.count > 0
              ? `${props.edges.count}개 변에 이격을 따로 정했습니다. 나머지 변은 경계 이격 ${fmt(p.boundarySetback, 1)} m를 씁니다.`
              : '도로 쪽처럼 한 변만 더 띄우려면 지도에서 그 변을 골라 거리를 넣으세요.'}
          </p>
        </div>
        <div className="row" style={{ margin: '8px 0' }}>
          <button type="button" className="secondary" disabled={isContinuous(p)} onClick={() => onParams(continuousParams(p))}>
            {isContinuous(p) ? '연속 배열 사용 중' : '줄 잇기(연속 배열)'}
          </button>
        </div>
        <p className="hint">
          연속 배열은 세트를 기둥 한 칸({p.portrait ? '세로 2열' : '가로 1열'}) 단위로 줄이고 모듈 간격으로 이어 붙여, 줄이 비스듬한 경계 끝까지 채워지게
          합니다.
        </p>
        <label className="row" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={props.pad.on} onChange={(e) => props.pad.onToggle(e.target.checked)} /> 수배전반·전기실 자리 비워 두기
          {props.pad.on && <small className="hint"> {props.pad.label ?? '들어갈 자리를 찾지 못했습니다'}</small>}
        </label>
        {props.pad.on && (
          <div className="pad-tools">
            <div className="row">
              <button type="button" className="secondary" disabled={props.pad.busy} onClick={props.pad.onFind}>
                {props.pad.busy ? '자리 찾는 중…' : '최적 자리 찾기'}
              </button>
              {props.pad.moved && (
                <button type="button" className="link" onClick={props.pad.onReset}>
                  기본 자리로
                </button>
              )}
            </div>
            {props.pad.status && <p className="hint">{props.pad.status}</p>}
            <p className="hint">{props.pad.rule}</p>
            <p className="hint">지도나 배치 편집에서 함체를 끌어 옮길 수도 있습니다. 옮기면 그 자리를 비워 다시 배치합니다.</p>
          </div>
        )}
        <label className="field">
          <span>배치 방식</span>
          <select value={props.layoutMode} onChange={(e) => props.onLayoutMode(e.target.value as LayoutMode)}>
            {LAYOUT_MODES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {props.layoutMode !== 'grid' && (
          <p className="hint">
            {props.layoutMode === 'fill'
              ? '위 방위각으로 채운 뒤, 경계를 따라 남은 자리에 경계 방향으로 돌린 세트를 더 놓습니다.'
              : '필지 경계 가운데 남쪽을 보는 긴 변마다 구역을 나누고, 구역마다 그 변에 맞춘 방위각(절충은 위 방위각과의 중간)과 그 방향에 맞는 열 이격거리로 채웁니다. 경사각은 모든 구역이 같습니다.'}{' '}
            비스듬한 경계가 없는 필지는 한 방향 배치와 같습니다.
          </p>
        )}
        <button type="button" className="block" disabled={!props.canLayout} onClick={props.onAutoLayout}>
          자동 배치
        </button>
        {!props.canLayout && <p className="hint">먼저 필지 탭에서 필지를 선택하세요.</p>}
        {props.maskActive && <p className="hint">지형 탭의 설계 가능 영역(경사·배수 제외 구역)을 피해서 배치합니다.</p>}
        <p className="hint">배치한 세트는 오른쪽 가배치 도면이나 지도에서 옮기고, 더하고, 지울 수 있습니다.</p>
      </section>

    </>
  )
}
