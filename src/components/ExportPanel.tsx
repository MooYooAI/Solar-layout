import type { ReactNode } from 'react'

export interface ExportItem {
  key: string
  label: string
  detail: string
  /** 못 받는 이유. 없으면 받을 수 있다. */
  disabled?: string
  run: () => void
}

interface Props {
  groups: Array<{ title: string; note?: ReactNode; items: ExportItem[] }>
  busy: boolean
}

export default function ExportPanel(props: Props) {
  return (
    <>
      {props.busy && <p className="hint">현재 배치를 계산하는 중입니다. 끝나면 최신 값으로 내보냅니다.</p>}
      {props.groups.map((g) => (
        <section className="card" key={g.title}>
          <h2>{g.title}</h2>
          <ul className="exports">
            {g.items.map((it) => (
              <li key={it.key}>
                <div>
                  <strong>{it.label}</strong>
                  <small>{it.disabled ?? it.detail}</small>
                </div>
                <button type="button" className="secondary" disabled={!!it.disabled} onClick={it.run}>
                  받기
                </button>
              </li>
            ))}
          </ul>
          {g.note && <p className="hint">{g.note}</p>}
        </section>
      ))}
    </>
  )
}
