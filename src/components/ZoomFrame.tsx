import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** 확대 창 제목 */
  title: string
  children: ReactNode
}

const STEPS = [1, 1.5, 2, 3]
/** 좁은 화면(휴대폰)에서는 처음부터 두 배로 띄워 옆으로 밀어 본다. */
const firstStep = () => (window.innerWidth < 700 ? 2 : 0)

/**
 * 도면을 감싸 클릭하면 화면 가득 크게 띄운다. 큰 창에서는 +/−로 더 키우고 스크롤로 훑어본다.
 * Esc, 바깥 클릭, 닫기 버튼으로 닫는다.
 */
export default function ZoomFrame({ title, children }: Props) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div
        className="zoomable"
        role="button"
        tabIndex={0}
        title="클릭하면 크게 봅니다"
        aria-label={`${title} 크게 보기`}
        onClick={() => {
          setStep(firstStep())
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setStep(firstStep())
            setOpen(true)
          }
        }}
      >
        {children}
        <span className="zoomable-hint" aria-hidden>
          ⤢ 크게 보기
        </span>
      </div>
      {open &&
        createPortal(
          <div className="zoom-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={() => setOpen(false)}>
            <div className="zoom-panel" onClick={(e) => e.stopPropagation()}>
              <div className="zoom-head">
                <strong>{title}</strong>
                <span className="zoom-tools">
                  <button type="button" className="ghost icon" disabled={step === 0} onClick={() => setStep((s) => s - 1)} aria-label="축소">
                    −
                  </button>
                  <span className="zoom-pct">{Math.round(STEPS[step] * 100)}%</span>
                  <button type="button" className="ghost icon" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)} aria-label="확대">
                    +
                  </button>
                  <button type="button" className="ghost" autoFocus onClick={() => setOpen(false)}>
                    닫기
                  </button>
                </span>
              </div>
              <div className="zoom-body">
                <div className="zoom-content" style={{ width: `${STEPS[step] * 100}%` }}>
                  {children}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
