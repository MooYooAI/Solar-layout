import { useEffect, useRef, useState } from 'react'
import { projectFromFile, type ProjectData, type ProjectMeta, type ProjectStore } from '../lib/projectStore'

interface Props {
  store: ProjectStore
  /** 목록을 다시 읽게 하는 값(저장할 때마다 바뀐다) */
  revision: number
  currentId: string | null
  canExport: boolean
  canSave: boolean
  onSaveAs: () => void
  onOpen: (id: string) => void
  onImport: (name: string, data: ProjectData) => void
  onExport: () => void
  onClose: () => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** 저장한 프로젝트 목록. 열기·지우기와 파일 내보내기·가져오기. */
export default function ProjectDialog(props: Props) {
  const { store } = props
  const [list, setList] = useState<ProjectMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    store.list().then(
      (l) => alive && setList(l),
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [store, props.revision, seq])

  const onClose = props.onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const remove = async (p: ProjectMeta) => {
    if (!window.confirm(`'${p.name}' 프로젝트를 지울까요? 되돌릴 수 없습니다.`)) return
    try {
      await store.remove(p.id)
      setSeq((n) => n + 1)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const { name, data } = projectFromFile(await f.text())
      props.onImport(name, data)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <header className="modal-head">
          <h2 id="project-dialog-title">프로젝트 불러오기</h2>
          <button type="button" className="ghost icon" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        <div className="modal-body">
          {error && <p className="error">{error}</p>}
          {list === null ? (
            <p className="hint">불러오는 중…</p>
          ) : list.length ? (
            <ul className="projects">
              {list.map((p) => (
                <li key={p.id} className={p.id === props.currentId ? 'current' : undefined}>
                  <div>
                    <strong>
                      {p.name}
                      {p.id === props.currentId && <em>지금 여는 중</em>}
                    </strong>
                    <small>
                      {p.address} · {p.sets ? `${fmt(p.sets)}세트 · ${fmt(p.kWp, 1)} kWp` : '배치 없음'} · {when(p.savedAt)}
                    </small>
                  </div>
                  <button type="button" className="outline" onClick={() => props.onOpen(p.id)}>
                    열기
                  </button>
                  <button type="button" className="ghost danger" onClick={() => void remove(p)}>
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="projects-empty">저장한 프로젝트가 없습니다. 맨 위 저장 버튼으로 지금 작업을 저장하세요.</p>
          )}
        </div>
        <footer className="modal-foot">
          <span className="hint">
            저장 위치: {store.label}. 로그인 기능이 생기면 계정에 저장해 어느 기기에서든 엽니다.
          </span>
          <div className="row">
            <button type="button" className="secondary" disabled={!props.canSave} onClick={props.onSaveAs}>
              새 이름으로 저장
            </button>
            <button type="button" className="secondary" disabled={!props.canExport} onClick={props.onExport}>
              파일로 내보내기
            </button>
            <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
              파일에서 불러오기
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e)} />
          </div>
        </footer>
      </div>
    </div>
  )
}
