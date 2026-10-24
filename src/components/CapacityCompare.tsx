export interface CapacityOption {
  key: 'standard' | 'recommended'
  label: string
  basis: string
  /** 열 이격(m) */
  spacing: number
  /** 그 열 이격의 음영각(°) */
  shadeAngle: number
  sets: number
  kWp: number
}

interface Props {
  rows: CapacityOption[]
  onApply: (r: CapacityOption) => void
}

const fmt = (n: number, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 표준(무음영 우선)과 권장(용량 우선) 설계용량을 나란히 보여 주고 고른 쪽으로 배치한다. AI 가설계 후보 아래에 참고로 붙는다. */
export default function CapacityCompare({ rows, onApply }: Props) {
  const std = rows.find((r) => r.key === 'standard')
  return (
    <section className="card">
      <h2>표준·권장 설계용량</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        지금 경사·방위는 그대로 두고 열 이격만 두 기준으로 바꿔 배치한 용량입니다. 표준은 겨울 낮 동안 앞 열 그림자가 없고, 권장은 한낮 위주로 그림자를
        피하면서 용량을 늘립니다.
      </p>
      <div className="cap-grid">
        {rows.map((r) => (
          <div key={r.key} className={`cap-opt ${r.key}`}>
            <header>
              <strong>{r.label} 설계용량</strong>
              {std && r.key !== 'standard' && std.kWp > 0 && <span className="rv-badge info">{`+${fmt(((r.kWp - std.kWp) / std.kWp) * 100)}%`}</span>}
            </header>
            <div className="cap-kwp">
              {fmt(r.kWp, 2)} <small>kWp</small>
            </div>
            <small>
              {r.basis}
              <br />열 이격 {fmt(r.spacing, 1)} m(음영각 {fmt(r.shadeAngle, 1)}°) · {fmt(r.sets, 0)}세트
            </small>
            <button type="button" className="block" disabled={!r.sets} onClick={() => onApply(r)}>
              이 기준으로 배치
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
