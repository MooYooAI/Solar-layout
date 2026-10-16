import { useRef } from 'react'

interface Props {
  /** 끄는 동안 시작점에서 움직인 가로 거리(px)를 받는다. */
  onResize: (dx: number) => void
  onStart: () => void
  onReset: () => void
  label: string
  /** 격자 칸 이름 */
  area: string
}

/** 패널 사이 세로 손잡이. 끌어서 폭을 바꾸고, 두 번 클릭하면 기본 폭으로 돌아간다. 키보드 ←/→도 된다. */
export default function Resizer(props: Props) {
  const start = useRef<number | null>(null)
  return (
    <div
      className="resizer"
      style={{ gridArea: props.area }}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = e.clientX
        props.onStart()
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => start.current !== null && props.onResize(e.clientX - start.current)}
      onPointerUp={() => {
        start.current = null
        document.body.classList.remove('resizing')
      }}
      onDoubleClick={props.onReset}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        props.onStart()
        props.onResize(e.key === 'ArrowLeft' ? -24 : 24)
      }}
    />
  )
}
