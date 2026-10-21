import { Fragment } from 'react'
import { licensingAuthority, permitList, schedule, smallEia, isForest } from '../lib/siteReview'
import { PERMIT_STATUS, type PermitProgress, type PermitStatus, type PlantInfo } from '../lib/stages'

interface Props {
  kWp: number
  address: string
  landCategory?: string
  area: number
  zoning: string[]
  progress: PermitProgress
  onProgress: (p: PermitProgress) => void
  plant: PlantInfo
  onPlant: (p: PlantInfo) => void
  /** 지번별 현장 정보 */
  lots: Array<{ address: string; land: string; area: number; zoning: string }>
  /** 설비 요약(항목, 값) */
  equipment: Array<[string, string]>
  onCsv: () => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

export default function PermitPanel(props: Props) {
  const eia = smallEia(props.area, props.zoning)
  const items = permitList(props.kWp, props.address, props.landCategory, props.area, eia.applies)
  const needed = items.filter((it) => it.need !== 'no')
  const skipped = items.filter((it) => it.need === 'no')
  const done = needed.filter((it) => props.progress[it.name]?.status === 'done').length
  const plan = schedule(props.kWp, eia.applies, isForest(props.landCategory))
  const set = (name: string, v: { status: PermitStatus; date?: string }) => props.onProgress({ ...props.progress, [name]: v })

  const plant = props.plant
  const text = (k: 'name' | 'owner' | 'bizNo' | 'phone', label: string, placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={plant[k]} placeholder={placeholder} onChange={(e) => props.onPlant({ ...plant, [k]: e.target.value })} />
    </label>
  )
  return (
    <>
      <section className="card">
        <h2>허가권자</h2>
        <dl className="facts wide">
          <dt>발전사업 허가</dt>
          <dd>{licensingAuthority(props.kWp, props.address)}</dd>
          <dt>설비용량</dt>
          <dd>{fmt(props.kWp, 1)} kW</dd>
          <dt>지목</dt>
          <dd>{props.landCategory ?? '확인 필요'}</dd>
          <dt>용도지역</dt>
          <dd>{props.zoning.length ? props.zoning.join(', ') : '확인 필요'}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>
          필요 인허가 <span className="hint">{`${done}/${needed.length} 완료`}</span>
        </h2>
        <ul className="permits">
          {needed.map((it) => {
            const p = props.progress[it.name] ?? { status: 'todo' as PermitStatus }
            return (
              <li key={it.name}>
                <div>
                  <strong>
                    {it.name} {it.need === 'maybe' && <span className="rv-badge warn">확인</span>}
                  </strong>
                  <small>{it.basis}</small>
                </div>
                <div className="permit-state">
                  <select aria-label={`${it.name} 진행 상황`} value={p.status} onChange={(e) => set(it.name, { ...p, status: e.target.value as PermitStatus })}>
                    {(Object.keys(PERMIT_STATUS) as PermitStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {PERMIT_STATUS[s]}
                      </option>
                    ))}
                  </select>
                  {(p.status === 'filed' || p.status === 'done') && (
                    <input
                      type="date"
                      aria-label={p.status === 'done' ? `${it.name} 완료일` : `${it.name} 접수일`}
                      value={p.date ?? ''}
                      onChange={(e) => set(it.name, { ...p, date: e.target.value || undefined })}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {skipped.length > 0 && <p className="hint">해당 없음: {skipped.map((it) => it.name).join(', ')}</p>}
      </section>

      <section className="card">
        <h2>발전소 정보 일람표</h2>
        <p>허가 신청서와 사업계획서에 공통으로 들어가는 값입니다. 부지와 설비는 설계에서 채우고, 사업자 정보만 적으면 됩니다.</p>
        <div className="grid2" style={{ marginTop: 10 }}>
          {text('name', '발전소 이름', '예: 해남 구성 태양광')}
          <label className="field">
            <span>사업자 구분</span>
            <select value={plant.ownerType} onChange={(e) => props.onPlant({ ...plant, ownerType: e.target.value as PlantInfo['ownerType'] })}>
              <option value="person">개인</option>
              <option value="corp">법인</option>
            </select>
          </label>
          {text('owner', plant.ownerType === 'corp' ? '법인명·대표자' : '성명', '')}
          {text('bizNo', plant.ownerType === 'corp' ? '법인·사업자번호' : '사업자번호', '000-00-00000')}
          {text('phone', '연락처', '010-0000-0000')}
        </div>
        <h3 className="sub">지번별 현장 정보</h3>
        <table className="order-table">
          <thead>
            <tr>
              <th>지번</th>
              <th>지목</th>
              <th>면적(㎡)</th>
            </tr>
          </thead>
          <tbody>
            {props.lots.map((l) => (
              <tr key={l.address}>
                <td>
                  {l.address}
                  <small className="cell-sub">{l.zoning}</small>
                </td>
                <td>{l.land}</td>
                <td>{fmt(l.area)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="sub">설비</h3>
        <dl className="facts wide">
          {props.equipment.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
        <button type="button" className="secondary block" onClick={props.onCsv}>
          일람표 CSV 받기
        </button>
      </section>

      <section className="card">
        <h2>예상 일정</h2>
        <dl className="facts wide">
          {plan.map((s) => (
            <Fragment key={s.name}>
              <dt>{s.name}</dt>
              <dd>{s.months}개월</dd>
            </Fragment>
          ))}
        </dl>
        <p className="hint">
          합계 약 {plan.reduce((a, s) => a + s.months, 0)}개월. 공개 기준으로 고른 참고 목록이며, 실제 대상과 기간은 관할 지자체와 한전에 확인해야 합니다.
        </p>
      </section>
    </>
  )
}
