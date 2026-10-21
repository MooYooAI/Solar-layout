import { useState } from 'react'

interface Props {
  /** 세트별 동지 9~15시 평균 그늘 비율(직달 손실 근사). 아직 안 쟀으면 null */
  shade: Map<string, number> | null
  busy: boolean
  hasSets: boolean
  onMeasure: () => void
  onSelect: (ids: string[]) => void
  onDelete: (ids: string[]) => void
}

const THRESHOLDS: Array<[number, string]> = [
  [0.01, '손실 1% 이상'],
  [0.02, '손실 2% 이상'],
  [0.05, '손실 5% 이상'],
  [0.1, '손실 10% 이상'],
]

export default function ShadeCleanup(props: Props) {
  const [limit, setLimit] = useState(0.02)
  const hits = props.shade ? [...props.shade].filter(([, f]) => f >= limit).map(([id]) => id) : []
  return (
    <section className="card">
      <h2>그림자 지는 세트 정리</h2>
      <p>동지 9~15시(태양시)에 앞 열·옆 세트·장애물 그림자로 잃는 직달 일사를 세트마다 재고, 기준을 넘는 세트를 고르거나 한 번에 지웁니다.</p>
      <label className="field" style={{ marginTop: 10 }}>
        <span>그늘 기준</span>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {THRESHOLDS.map(([t, label]) => (
            <option key={t} value={t}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="secondary block" disabled={!props.hasSets || props.busy} onClick={props.onMeasure}>
        {props.busy ? '재는 중…' : props.shade ? '다시 재기' : '세트별 그늘 재기'}
      </button>
      {props.shade && (
        <>
          <p className="hint">
            {hits.length ? `${props.shade.size}세트 중 ${hits.length}세트가 기준을 넘습니다.` : `${props.shade.size}세트 모두 기준 안쪽입니다.`}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" disabled={!hits.length} onClick={() => props.onSelect(hits)}>
              지도에서 선택
            </button>
            <button type="button" disabled={!hits.length} onClick={() => props.onDelete(hits)}>
              {`${hits.length}세트 삭제`}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
