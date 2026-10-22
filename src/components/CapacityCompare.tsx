export interface CapacityOption {
  key: 'standard' | 'recommended'
  label: string
  basis: string
  /** 열 이격(m) */
  spacing: number
  sets: number
  kWp: number
}

interface Props {
  /** 지금 설정으로 계산한 결과. 설정이 바뀌면 null */
  rows: CapacityOption[] | null
  current: { spacing: number; kWp: number }
  onCompare: () => void
  onApply: (r: CapacityOption) => void
}

const fmt = (n: number, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 표준(무음영 우선)과 권장(용량 우선) 설계용량을 나란히 보여 주고 고른 쪽으로 배치한다. */
export default function CapacityCompare({ rows, current, onCompare, onApply }: Props) {
  const std = rows?.find((r) => r.key === 'standard')
  return (
    <section className="card">
      <h2>표준·권장 설계용량</h2>
      <p>열 이격만 바꿔 두 기준으로 배치해 봅니다. 표준은 겨울 낮 동안 앞 열 그림자가 없고, 권장은 한낮 위주로 그림자를 피하면서 용량을 늘립니다.</p>
      {rows ? (
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
                <br />열 이격 {fmt(r.spacing, 1)} m · {fmt(r.sets, 0)}세트
              </small>
              <button
                type="button"
                className={Math.abs(current.spacing - r.spacing) < 0.05 ? 'secondary block' : 'block'}
                disabled={!r.sets}
                onClick={() => onApply(r)}
              >
                {Math.abs(current.spacing - r.spacing) < 0.05 ? '다시 배치' : '이 기준으로 배치'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button type="button" className="secondary block" onClick={onCompare}>
          두 기준으로 용량 계산
        </button>
      )}
      {rows && <p className="hint">지금 배치: {current.kWp > 0 ? `${fmt(current.kWp, 2)} kWp` : '없음'}, 열 이격 {fmt(current.spacing, 1)} m</p>}
    </section>
  )
}
