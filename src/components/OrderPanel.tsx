import { INVERTERS, RACKING } from '../lib/catalog'
import type { DesignMetrics } from '../lib/design'
import type { ElecParams } from '../lib/electrical'
import type { LayoutParams } from '../lib/layout'

interface Props {
  metrics: DesignMetrics | null
  busy: boolean
  params: LayoutParams
  elec: ElecParams
  onCsv: () => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

export default function OrderPanel({ metrics: m, busy, params, elec, onCsv }: Props) {
  if (!m) {
    return (
      <section className="card">
        <p className="hint">{busy ? '설계를 계산하는 중입니다.' : '배치가 있어야 물량을 낼 수 있습니다.'}</p>
      </section>
    )
  }
  const inverter = INVERTERS.find((i) => i.id === elec.inverterId)
  const rows: Array<[string, string, string]> = [
    ['모듈', `${fmt(params.moduleWatt)} W · ${fmt(params.moduleLength)}×${fmt(params.moduleWidth)} mm`, `${fmt(m.modules)} 장`],
    ['인버터', inverter?.label ?? `${fmt(elec.inverterKW)} kW`, `${fmt(m.inverters)} 대`],
    ['구조물', RACKING[params.racking].label, `${fmt(m.sets)} 세트`],
    ['스트링', `${m.stringLen}직렬`, `${fmt(m.strings)} 회로`],
  ]
  return (
    <>
      <section className="card">
        <h2>주요 기자재</h2>
        <table className="order-table">
          <thead>
            <tr>
              <th>품목</th>
              <th>규격</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, spec, qty]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{spec}</td>
                <td>{qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.unusedModules > 0 && <p className="hint">스트링에 묶이지 않은 모듈 {fmt(m.unusedModules)}장은 수량에서 뺐습니다.</p>}
      </section>

      <section className="card">
        <h2>설치비 내역</h2>
        <table className="order-table">
          <thead>
            <tr>
              <th>항목</th>
              <th>물량</th>
              <th>만원</th>
            </tr>
          </thead>
          <tbody>
            {m.capex.items.map((it) => (
              <tr key={it.key}>
                <td>{it.label}</td>
                <td>{it.basis}</td>
                <td>{fmt(it.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>합계 ({fmt(m.capexPerKW)} 만원/kW)</td>
              <td>{fmt(m.capex.total)}</td>
            </tr>
          </tfoot>
        </table>
        <button type="button" className="secondary block" onClick={onCsv}>
          설치비 내역 CSV 받기
        </button>
        <p className="hint">단가는 경제성 단계의 설치비 설정을 따릅니다. 업체 견적을 받기 전 기준값으로 쓰세요.</p>
      </section>
    </>
  )
}
