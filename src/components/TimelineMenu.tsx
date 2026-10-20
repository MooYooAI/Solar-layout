import { useEffect, useRef, useState } from 'react'
import Timeline from './Timeline'
import type { TimelineEntry } from '../lib/timeline'

interface Props {
  entries: TimelineEntry[]
  currentId: string | null
  onRestore: (e: TimelineEntry) => void
  onClear: () => void
}

/** 상단 바의 타임라인 버튼. 누르면 작업 기록이 아래로 펼쳐진다. */
export default function TimelineMenu(props: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        타임라인
        {props.entries.length > 0 && <span className="count">{props.entries.length}</span>}
      </button>
      {open && (
        <div className="menu-pop timeline-pop" role="dialog" aria-label="작업 타임라인">
          <Timeline
            entries={props.entries}
            currentId={props.currentId}
            onRestore={(e) => {
              props.onRestore(e)
              setOpen(false)
            }}
            onClear={props.onClear}
          />
        </div>
      )}
    </div>
  )
}
