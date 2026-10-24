import { rowSpacingForShadeAngle, shadeAngle, type LayoutParams } from '../lib/layout'

interface Props {
  params: LayoutParams
  onParams: (p: LayoutParams) => void
  /** 동지 9~15시 무음영 이격거리(m). 모르면 null */
  noShadeSpacing: number | null
  canPlace: boolean
  onPlace: () => void
  kWp: number
}

const fmt = (n: number, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 지도 위에 띄우는 설계 옵션 줄: 자주 바꾸는 배치 값만 모아 바로 고치고 다시 배치한다. */
export default function DesignBar({ params: p, onParams, noShadeSpacing, canPlace, onPlace, kWp }: Props) {
  const num = (k: 'tilt' | 'azimuth' | 'rowSpacing' | 'boundarySetback' | 'setRows', label: string, unit: string, step: number, min: number, max: number) => (
    <label className="db-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={p[k]}
        onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && onParams({ ...p, [k]: Math.min(max, Math.max(min, e.target.valueAsNumber)) })}
      />
      <em>{unit}</em>
    </label>
  )
  const narrow = noShadeSpacing !== null && p.rowSpacing + 0.005 < noShadeSpacing
  return (
    <div className="design-bar" role="group" aria-label="설계 옵션">
      {num('tilt', '경사', '°', 1, 0, 60)}
      {num('azimuth', '방위', '°', 1, -90, 90)}
      {num('rowSpacing', '열 이격', 'm', 0.1, 0, 30)}
      <label className="db-field">
        <span>음영각</span>
        <input
          type="number"
          step={0.5}
          min={5}
          max={60}
          value={Math.round(shadeAngle(p) * 10) / 10}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            if (v > 0 && v < 90) onParams({ ...p, rowSpacing: Math.min(30, rowSpacingForShadeAngle(p, v)) })
          }}
        />
        <em>°</em>
      </label>
      {num('boundarySetback', '경계 이격', 'm', 0.5, 0, 50)}
      {num('setRows', '단수', '단', 1, 1, 8)}
      <label className="db-field">
        <span>방향</span>
        <select value={p.portrait ? 'portrait' : 'landscape'} onChange={(e) => onParams({ ...p, portrait: e.target.value === 'portrait' })}>
          <option value="portrait">세로</option>
          <option value="landscape">가로</option>
        </select>
      </label>
      <button type="button" disabled={!canPlace} onClick={onPlace}>
        다시 배치
      </button>
      <span className="db-sum">
        {kWp > 0 ? `${fmt(kWp)} kWp` : '배치 전'}
        {noShadeSpacing !== null && (
          <small className={narrow ? 'warn' : ''}>
            {narrow ? `동지 무음영 ${fmt(noShadeSpacing, 2)} m보다 좁음` : `동지 무음영 ${fmt(noShadeSpacing, 2)} m 이상`}
          </small>
        )}
      </span>
    </div>
  )
}
