import { overallGrade, VERDICT_LABEL, type SectionReview, type Verdict } from '../lib/siteReview'
import {
  BASE_DISTANCE,
  OWNER_KIND,
  SITE_KIND,
  roadFromPicked,
  type GridEval,
  type OwnerKind,
  type RoadCandidate,
  type RoadEval,
  type SiteCheck,
  type SiteKind,
} from '../lib/siteCheck'

interface Props {
  check: SiteCheck
  onCheck: (c: SiteCheck) => void
  /** 조회한 값(보정 전) */
  fetched: { landCategory?: string; zoning: string[]; area: number }
  hasParcel: boolean
  canFindRoads: boolean
  roads: RoadCandidate[] | null
  roadBusy: boolean
  roadError: string | null
  onFindRoads: () => void
  /** 연계 용량(AC kW). 배치 전이면 null */
  needKW: number | null
  picking: boolean
  onPickPole: () => void
  forest: boolean
  terrainSlopeDeg: number | null
  onGoTerrain: () => void
  reviews: { land: SectionReview; terrain: SectionReview; road: RoadEval; grid: GridEval; forest: SectionReview | null }
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 지목 28종. 값은 지번 끝에 붙는 약칭 */
const LAND_CATEGORIES: Array<[string, string]> = [
  ['전', '전'], ['답', '답'], ['과', '과수원'], ['목', '목장용지'], ['임', '임야'], ['광', '광천지'], ['염', '염전'],
  ['대', '대'], ['장', '공장용지'], ['학', '학교용지'], ['차', '주차장'], ['주', '주유소용지'], ['창', '창고용지'], ['도', '도로'],
  ['철', '철도용지'], ['제', '제방'], ['천', '하천'], ['구', '구거'], ['유', '유지'], ['양', '양어장'], ['수', '수도용지'],
  ['공', '공원'], ['체', '체육용지'], ['원', '유원지'], ['종', '종교용지'], ['사', '사적지'], ['묘', '묘지'], ['잡', '잡종지'],
]
const landName = (c?: string) => (c ? (LAND_CATEGORIES.find(([k]) => k === c)?.[1] ?? c) : undefined)

const ZONES = [
  '계획관리지역', '생산관리지역', '보전관리지역', '농림지역', '자연환경보전지역',
  '자연녹지지역', '생산녹지지역', '보전녹지지역', '일반공업지역', '준공업지역', '전용공업지역',
  '제1종일반주거지역', '제2종일반주거지역', '준주거지역', '일반상업지역',
]

function Badge({ v }: { v: Verdict }) {
  return <span className={`rv-badge ${v}`}>{VERDICT_LABEL[v]}</span>
}

function VerdictBox({ r }: { r: SectionReview }) {
  return (
    <div className={`sr-verdict ${r.verdict}`}>
      <strong>
        <Badge v={r.verdict} /> {r.summary}
      </strong>
      {r.checks.length > 0 && (
        <ul>
          {r.checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const numOrUndef = (v: number) => (Number.isNaN(v) ? undefined : v)

export default function SiteReviewPanel(props: Props) {
  const c = props.check
  const set = (patch: Partial<SiteCheck>) => props.onCheck({ ...c, ...patch })
  const land = (patch: Partial<SiteCheck['land']>) => set({ land: { ...c.land, ...patch } })
  const road = (patch: Partial<SiteCheck['road']>) => set({ road: { ...c.road, ...patch } })
  const grid = (patch: Partial<SiteCheck['grid']>) => set({ grid: { ...c.grid, ...patch } })
  const togglePick = (pnu: string) => {
    const picked = c.road.picked.includes(pnu) ? c.road.picked.filter((p) => p !== pnu) : [...c.road.picked, pnu]
    const vals = props.roads ? roadFromPicked(props.roads, picked) : null
    road({ picked, ...(vals ?? { gap: undefined, width: undefined, frontage: undefined }) })
  }
  const numField = (label: string, value: number | undefined, onChange: (v: number | undefined) => void, unit: string, placeholder = '', step = 1) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} step={step} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(numOrUndef(e.target.valueAsNumber))} />
      <em>{unit}</em>
    </label>
  )
  const r = props.reviews
  const sections = [r.land, r.terrain, r.road.review, r.grid.review, ...(r.forest ? [r.forest] : [])]
  const overall = overallGrade(sections)

  if (!props.hasParcel)
    return (
      <section className="card">
        <p className="hint">부지 화면에서 부지를 먼저 고르세요.</p>
      </section>
    )

  return (
    <>
      <section className="card">
        <h2>
          입지 종합 <span className={`grade g-${overall.grade}`}>{overall.grade}</span>
        </h2>
        <p>{overall.text}</p>
        <ul className="sr-sum">
          {sections.map((s) => (
            <li key={s.key}>
              <span>{s.title}</span>
              <Badge v={s.verdict} />
              <small>{s.summary}</small>
            </li>
          ))}
        </ul>
        {overall.unknown > 0 && <p className="hint">미확인 {overall.unknown}개 항목은 등급에서 뺐습니다. 아래에서 채우면 판정합니다.</p>}
      </section>

      <section className="card">
        <h2>설치 장소와 토지 정보</h2>
        <div className="seg3" role="group" aria-label="설치 장소">
          {(Object.keys(SITE_KIND) as SiteKind[]).map((k) => (
            <button key={k} type="button" className={c.kind === k ? 'on' : ''} aria-pressed={c.kind === k} onClick={() => set({ kind: k })}>
              {SITE_KIND[k].label}
              <small>{SITE_KIND[k].sub}</small>
            </button>
          ))}
        </div>
        <p className="hint">조회한 값이 틀리거나 비어 있으면 고쳐 넣으세요. 고친 값이 인허가·보고서 판정에 쓰입니다.</p>
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field">
            <span>지목 {c.land.landCategory && <small className="hint">(조회 {landName(props.fetched.landCategory) ?? '없음'})</small>}</span>
            <select value={c.land.landCategory ?? props.fetched.landCategory ?? ''} onChange={(e) => land({ landCategory: e.target.value === props.fetched.landCategory ? undefined : e.target.value || undefined })}>
              <option value="">미확인</option>
              {LAND_CATEGORIES.map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {numField('대장 면적', c.land.area, (v) => land({ area: v }), '㎡', fmt(props.fetched.area))}
          <label className="field">
            <span>용도지역 {c.land.zoning && <small className="hint">(조회 {props.fetched.zoning.join(', ') || '없음'})</small>}</span>
            <input
              list="sr-zones"
              value={c.land.zoning ?? props.fetched.zoning.join(', ')}
              placeholder="예: 계획관리지역"
              onChange={(e) => land({ zoning: e.target.value === props.fetched.zoning.join(', ') ? undefined : e.target.value })}
            />
            <datalist id="sr-zones">
              {ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>소유 구분</span>
            <select value={c.land.owner ?? ''} onChange={(e) => land({ owner: (e.target.value || undefined) as OwnerKind | undefined })}>
              <option value="">미확인</option>
              {(Object.keys(OWNER_KIND) as OwnerKind[]).map((k) => (
                <option key={k} value={k}>
                  {OWNER_KIND[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <VerdictBox r={r.land} />
        <p className="hint">
          행위제한은{' '}
          <a href="https://www.eum.go.kr" target="_blank" rel="noreferrer">
            토지이음
          </a>
          의 토지이용계획에서 확인할 수 있습니다.
        </p>
      </section>

      <section className="card">
        <h2>지형</h2>
        <VerdictBox r={r.terrain} />
        <button type="button" className="secondary block" onClick={props.onGoTerrain}>
          {props.terrainSlopeDeg === null ? '지형 분석하러 가기' : '지형 화면 열기'}
        </button>
      </section>

      <section className="card">
        <h2>도로 접면</h2>
        <p>개발행위 허가에는 공사·관리 차량이 드나들 진입로가 필요합니다. 주변 도로·구거 지번을 찾아 진입로로 쓸 것을 고르세요.</p>
        <button type="button" className="block" disabled={!props.canFindRoads || props.roadBusy} onClick={props.onFindRoads}>
          {props.roadBusy ? '찾는 중…' : props.roads ? '주변 도로 다시 찾기' : '주변 도로·구거 찾기'}
        </button>
        {!props.canFindRoads && <p className="hint">지번으로 고른 부지에서만 찾을 수 있습니다(VWorld 키 필요). 아래에 직접 넣어도 됩니다.</p>}
        {props.roadError && <p className="error">{props.roadError}</p>}
        {props.roads && (
          props.roads.length ? (
            <table className="order-table sr-roads">
              <thead>
                <tr>
                  <th />
                  <th>지번</th>
                  <th>거리</th>
                  <th>추정 폭</th>
                </tr>
              </thead>
              <tbody>
                {props.roads.map((rd) => (
                  <tr key={rd.pnu}>
                    <td>
                      <input type="checkbox" aria-label={`${rd.label} 진입로로 쓰기`} checked={c.road.picked.includes(rd.pnu)} onChange={() => togglePick(rd.pnu)} />
                    </td>
                    <td>
                      {rd.label}
                      <small className="cell-sub">{rd.kind}{rd.frontage > 0 ? ` · 접면 ${fmt(rd.frontage, 1)} m` : ''}</small>
                    </td>
                    <td>{rd.distance <= 0.6 ? '접함' : `${fmt(rd.distance, 1)} m`}</td>
                    <td>{`${fmt(rd.width, 1)} m`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">부지 둘레 150 m 안에 지목이 도로·구거인 지번이 없습니다.</p>
          )
        )}
        <h3 className="sub">실측·직접 입력</h3>
        <div className="grid2" style={{ marginTop: 6 }}>
          {numField('도로 폭', c.road.width, (v) => road({ width: v }), 'm', '예: 4', 0.1)}
          {numField('접면 길이', c.road.frontage, (v) => road({ frontage: v }), 'm', '예: 15', 0.5)}
          {numField('도로까지 거리', c.road.gap, (v) => road({ gap: v }), 'm', '접하면 0', 0.5)}
          <label className="field">
            <span>포장</span>
            <select value={c.road.paved ?? ''} onChange={(e) => road({ paved: (e.target.value || undefined) as 'yes' | 'no' | undefined })}>
              <option value="">미확인</option>
              <option value="yes">포장</option>
              <option value="no">비포장</option>
            </select>
          </label>
          {numField('조례 기준 폭', c.road.minWidth, (v) => road({ minWidth: v ?? 4 }), 'm', '', 0.5)}
        </div>
        <VerdictBox r={r.road.review} />
        {r.road.score !== null && <p className="hint">도로 점수 {r.road.score}점. 폭은 지적 형상으로 추정한 값이라 현장 실측으로 확인하세요.</p>}
      </section>

      <section className="card">
        <h2>계통연계</h2>
        <p>
          {props.needKW === null ? (
            '배치 전이라 연계 용량은 아직 모릅니다. '
          ) : (
            <>
              연계 용량 <strong>{fmt(props.needKW, 1)} kW</strong>({props.needKW < 100 ? '저압' : '특고압 22.9 kV'} 연계 예상).{' '}
            </>
          )}
          한전ON에서 조회한 여유용량을 넣으면 접속 가능성을 판정합니다.
        </p>
        <div className="grid3" style={{ marginTop: 8 }}>
          {numField('변전소 여유', c.grid.substation, (v) => grid({ substation: v }), 'kW')}
          {numField('주변압기 여유', c.grid.transformer, (v) => grid({ transformer: v }), 'kW')}
          {numField('배전선로 여유', c.grid.feeder, (v) => grid({ feeder: v }), 'kW')}
        </div>
        <h3 className="sub">가장 가까운 3상 전주</h3>
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className={props.picking ? '' : 'secondary'} onClick={props.onPickPole}>
            {props.picking ? '찍기 취소' : c.grid.pole ? '전주 다시 찍기' : '지도에서 전주 찍기'}
          </button>
          {c.grid.pole && (
            <button type="button" className="secondary" onClick={() => grid({ pole: undefined })}>
              지우기
            </button>
          )}
        </div>
        {props.picking && <p className="hint">위성지도에서 전주 자리를 클릭하세요.</p>}
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field">
            <span>공급 방식</span>
            <select value={c.grid.line} onChange={(e) => grid({ line: e.target.value as SiteCheck['grid']['line'] })}>
              <option value="overhead">가공(전주)</option>
              <option value="underground">지중</option>
            </select>
          </label>
          {numField('전주 거리(실측)', c.grid.poleDistance, (v) => grid({ poleDistance: v }), 'm', r.grid.distance !== null && c.grid.poleDistance === undefined ? fmt(r.grid.distance) : '지도로 재기')}
          <label className="field">
            <span>전주 번호</span>
            <input value={c.grid.poleNo} placeholder="전주 명판의 번호" onChange={(e) => grid({ poleNo: e.target.value })} />
          </label>
        </div>
        {r.grid.distance !== null && (
          <dl className="facts wide" style={{ marginTop: 8 }}>
            <dt>전주까지</dt>
            <dd>{fmt(r.grid.distance)} m (기본 거리 {BASE_DISTANCE[c.grid.line]} m)</dd>
            <dt>초과 공사비</dt>
            <dd>{r.grid.extraCost ? `약 ${fmt(r.grid.extraCost)} 만원` : '기본 거리 안: 없음'}</dd>
          </dl>
        )}
        <details style={{ marginTop: 8 }}>
          <summary>초과 거리 단가 고치기</summary>
          <div className="grid2" style={{ marginTop: 8 }}>
            {numField('가공', c.grid.overheadWonPerM, (v) => grid({ overheadWonPerM: v ?? 0 }), '원/m', '', 1000)}
            {numField('지중', c.grid.undergroundWonPerM, (v) => grid({ undergroundWonPerM: v ?? 0 }), '원/m', '', 1000)}
          </div>
          <p className="hint">한전 기본공급약관의 거리 시설부담금을 대략 잡은 참고값입니다. 실제 금액은 한전 사전기술검토로 정해집니다.</p>
        </details>
        <VerdictBox r={r.grid.review} />
        <p className="hint">
          여유용량과 담당 사업소는{' '}
          <a href="https://online.kepco.co.kr" target="_blank" rel="noreferrer">
            한전ON
          </a>
          에서 주소로 조회할 수 있습니다. 공개 여유용량은 참고값이며 접속 가능 여부는 관할 한전 지사가 정합니다.
        </p>
      </section>

      {r.forest && (
        <section className="card">
          <h2>산지 기준</h2>
          <p>임야에 태양광을 놓으려면 평균경사와 입목축적이 기준 안이어야 합니다.</p>
          <div className="grid2" style={{ marginTop: 8 }}>
            {numField('입목축적', c.forest.stockPct, (v) => set({ forest: { ...c.forest, stockPct: v } }), '%', '관할 평균 대비')}
            {numField('평균경사', c.forest.slopeDeg, (v) => set({ forest: { ...c.forest, slopeDeg: v } }), '°', props.terrainSlopeDeg === null ? '지형 분석값' : fmt(props.terrainSlopeDeg, 1), 0.1)}
          </div>
          <VerdictBox r={r.forest} />
          <p className="hint">
            임상도와 입목축적은{' '}
            <a href="https://map.forest.go.kr" target="_blank" rel="noreferrer">
              산림공간정보서비스
            </a>
            에서 확인할 수 있습니다.
          </p>
        </section>
      )}
    </>
  )
}
