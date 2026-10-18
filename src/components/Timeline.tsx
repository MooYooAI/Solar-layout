import type { TimelineEntry } from '../lib/timeline'

interface Props {
  entries: TimelineEntry[]
  currentId: string | null
  onRestore: (e: TimelineEntry) => void
  onClear: () => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

function when(t: number) {
  const d = new Date(t)
  const today = new Date()
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 작업 기록. 최근 것이 위. 어느 시점이든 그때의 부지·배치로 돌아갈 수 있고, 돌아가도 기록은 지워지지 않는다. */
export default function Timeline(props: Props) {
  const list = [...props.entries].reverse()
  if (!list.length)
    return <p className="timeline-empty">필지를 고르고 배치하면 작업 단계가 여기에 쌓입니다. 언제든 그 시점으로 돌아갈 수 있습니다.</p>
  return (
    <>
      <ol className="timeline">
        {list.map((e, i) => {
          const current = e.id === props.currentId
          const prev = list[i + 1]
          const newSite = !prev || prev.parcel.address !== e.parcel.address
          return (
            <li key={e.id} className={current ? 'current' : undefined} aria-current={current ? 'step' : undefined}>
              <time dateTime={new Date(e.time).toISOString()}>{when(e.time)}</time>
              <div className="timeline-body">
                <strong>{e.label}</strong>
                <small>
                  {newSite && `${e.parcel.address} · `}
                  {e.sets.length ? `${fmt(e.sets.length)}세트 · ${fmt(e.kWp, 1)} kWp` : '배치 없음'}
                </small>
              </div>
              {current ? (
                <span className="timeline-now">지금</span>
              ) : (
                <button type="button" className="outline" onClick={() => props.onRestore(e)}>
                  이 작업으로 돌아가기
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <div className="timeline-foot">
        <span>최근 {props.entries.length}개 · 이 브라우저에 저장</span>
        <button type="button" className="ghost danger" onClick={() => window.confirm('작업 기록을 모두 지울까요? 지금 화면의 배치는 그대로 남습니다.') && props.onClear()}>
          기록 지우기
        </button>
      </div>
    </>
  )
}
