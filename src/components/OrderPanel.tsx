import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DesignMetrics } from '../lib/design'
import { download, toCsv } from '../lib/export/exports'
import { ORDER_PACKAGES, type OrderLine, type OrderPackage } from '../lib/order'
import type { PlantInfo } from '../lib/stages'

interface Props {
  metrics: DesignMetrics | null
  busy: boolean
  lines: OrderLine[]
  plant: PlantInfo
  address: string
  fileBase: string
  onCsv: () => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const PKGS = Object.keys(ORDER_PACKAGES) as OrderPackage[]
const today = () => new Date().toISOString().slice(0, 10)

export default function OrderPanel({ metrics: m, busy, lines, plant, address, fileBase, onCsv }: Props) {
  const [pick, setPick] = useState<Record<OrderPackage, boolean>>({ module: true, inverter: true, racking: true, electric: true, civil: true })
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    const id = requestAnimationFrame(() => window.print())
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  const groups = useMemo(() => PKGS.map((pkg) => ({ pkg, lines: lines.filter((l) => l.pkg === pkg) })).filter((g) => g.lines.length), [lines])
  if (!m) {
    return (
      <section className="card">
        <p className="hint">{busy ? '설계를 계산하는 중입니다.' : '배치가 있어야 물량을 낼 수 있습니다.'}</p>
      </section>
    )
  }
  const total = lines.reduce((a, l) => a + (l.amount ?? 0), 0)
  const quoteLines = lines.filter((l) => pick[l.pkg])
  const quoteCsv = () =>
    download(
      `${fileBase}-quote-request.csv`,
      toCsv(
        ['번호', '묶음', '품목', '규격', '단위', '수량', '단가(원)', '금액(원)', '비고'],
        quoteLines.map((l, i) => [i + 1, ORDER_PACKAGES[l.pkg], l.item, l.spec, l.unit, l.qty, '', '', '']),
      ),
      'text/csv',
    )
  const orderCsv = () =>
    download(
      `${fileBase}-order-list.csv`,
      toCsv(
        ['묶음', '품목', '규격', '단위', '수량', '예상 금액(만원)'],
        lines.map((l) => [ORDER_PACKAGES[l.pkg], l.item, l.spec, l.unit, l.qty, l.amount]),
      ),
      'text/csv',
    )

  return (
    <>
      <section className="card">
        <h2>발주목록</h2>
        <p>확정한 설계의 자재와 공사를 업체 단위 묶음으로 나눴습니다. 예상 금액은 경제성 단계의 설치비 단가로 낸 값입니다.</p>
        <table className="order-table order-list">
          <thead>
            <tr>
              <th>품목</th>
              <th>수량</th>
              <th>예상 만원</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.pkg}>
              <tr className="group">
                <td colSpan={2}>{ORDER_PACKAGES[g.pkg]}</td>
                <td>{fmt(g.lines.reduce((a, l) => a + (l.amount ?? 0), 0))}</td>
              </tr>
              {g.lines.map((l) => (
                <tr key={l.item + l.spec}>
                  <td>
                    {l.item}
                    <small className="cell-sub">{l.spec}</small>
                  </td>
                  <td>{`${fmt(l.qty)} ${l.unit}`}</td>
                  <td>{l.amount === null ? '-' : fmt(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <td colSpan={2}>발주 합계</td>
              <td>{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
        {m.unusedModules > 0 && <p className="hint">스트링에 묶이지 않은 모듈 {fmt(m.unusedModules)}장은 수량에서 뺐습니다.</p>}
        <p className="hint">설계·인허가·감리비({fmt(m.capex.total - total)}만원)는 발주 대상이 아니라서 합계에서 뺐습니다.</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={orderCsv}>
            발주목록 CSV
          </button>
          <button type="button" className="secondary" onClick={onCsv}>
            설치비 내역 CSV
          </button>
        </div>
      </section>

      <section className="card">
        <h2>견적 요청서</h2>
        <p>고른 묶음의 품목·규격·수량을 업체에 보낼 견적 요청서로 만듭니다. 단가 칸은 비워 둡니다.</p>
        <div className="check-list" style={{ marginTop: 10 }}>
          {groups.map((g) => (
            <label key={g.pkg}>
              <input type="checkbox" checked={pick[g.pkg]} onChange={(e) => setPick({ ...pick, [g.pkg]: e.target.checked })} /> {ORDER_PACKAGES[g.pkg]}
              <small className="hint"> {g.lines.length}품목</small>
            </label>
          ))}
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field">
            <span>회신 기한</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <label className="field" style={{ marginTop: 8 }}>
          <span>요청 사항</span>
          <textarea rows={3} value={note} placeholder="예: 운반·설치 포함 단가, 납기, 보증 기간을 함께 적어 주세요." onChange={(e) => setNote(e.target.value)} />
        </label>
        {!plant.owner && <p className="hint">발신인은 인허가 단계의 발전소 정보 일람표에 적은 사업자 정보를 씁니다.</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled={!quoteLines.length} onClick={() => setPrinting(true)}>
            인쇄·PDF
          </button>
          <button type="button" className="secondary" disabled={!quoteLines.length} onClick={quoteCsv}>
            CSV
          </button>
        </div>
      </section>

      {printing &&
        createPortal(
          <div className="quote-print">
            <QuoteDoc lines={quoteLines} plant={plant} address={address} kWp={m.kWp} due={due} note={note} />
          </div>,
          document.body,
        )}
    </>
  )
}

function QuoteDoc(props: { lines: OrderLine[]; plant: PlantInfo; address: string; kWp: number; due: string; note: string }) {
  const p = props.plant
  return (
    <article className="quote-doc">
      <h1>견 적 요 청 서</h1>
      <table className="quote-head">
        <tbody>
          <tr>
            <th>수신</th>
            <td>귀하</td>
            <th>요청일</th>
            <td>{today()}</td>
          </tr>
          <tr>
            <th>발신</th>
            <td>{[p.owner, p.name].filter(Boolean).join(' · ') || ' '}</td>
            <th>연락처</th>
            <td>{p.phone || ' '}</td>
          </tr>
          <tr>
            <th>현장</th>
            <td>{props.address}</td>
            <th>설비용량</th>
            <td>{fmt(props.kWp, 2)} kWp</td>
          </tr>
          <tr>
            <th>회신 기한</th>
            <td colSpan={3}>{props.due || ' '}</td>
          </tr>
        </tbody>
      </table>
      <p>아래 품목의 견적을 요청드립니다.</p>
      <table className="quote-items">
        <thead>
          <tr>
            <th>번호</th>
            <th>품목</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가(원)</th>
            <th>금액(원)</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          {props.lines.map((l, i) => (
            <tr key={l.item + l.spec}>
              <td>{i + 1}</td>
              <td>{l.item}</td>
              <td>{l.spec}</td>
              <td>{l.unit}</td>
              <td className="num">{fmt(l.qty)}</td>
              <td />
              <td />
              <td />
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={6}>합계(부가세 별도)</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
      {props.note && (
        <>
          <h2>요청 사항</h2>
          <p className="quote-note">{props.note}</p>
        </>
      )}
    </article>
  )
}
