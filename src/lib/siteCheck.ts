// 현장정보 단계의 입지검토: 토지 정보 보정, 도로 접면, 계통연계, 임야 기준을 판정한다. 화면 없이 값만 다룬다.
// 기준값은 공개 법령·한전 약관의 대표값이며, 지자체 조례와 한전 확인이 우선한다는 전제로 쓴다.
import { LocalFrame, pointInRing, segSegDist, type Vec } from './geo'
import { isFarmland, isForest, type SectionReview, type Verdict } from './siteReview'

export type SiteKind = 'land' | 'building' | 'mixed'
export const SITE_KIND: Record<SiteKind, { label: string; sub: string }> = {
  land: { label: '토지', sub: '지상·임야' },
  building: { label: '건물', sub: '옥상·지붕' },
  mixed: { label: '복합', sub: '토지+건물' },
}
export type OwnerKind = 'person' | 'corp' | 'public'
export const OWNER_KIND: Record<OwnerKind, string> = { person: '개인', corp: '법인', public: '국공유' }

/** 토지소유정보의 소유구분 이름을 세 갈래로 묶는다. 국공유가 하나라도 섞이면 국공유로 본다. */
export function ownerKindOf(names: string[]): OwnerKind | undefined {
  if (!names.length) return undefined
  if (names.some((n) => /국유|공유지|시유|도유|군유|구유|시도유|지자체|국가/.test(n))) return 'public'
  if (names.some((n) => /법인|종중|종교|단체|회사|조합/.test(n))) return 'corp'
  if (names.some((n) => /개인|외국인/.test(n))) return 'person'
  return undefined
}

/** 조회값이 틀리거나 비었을 때 사람이 고쳐 넣는 값. 비워 두면 조회값을 쓴다. */
export interface LandOverride {
  landCategory?: string
  zoning?: string
  /** 대장 면적(㎡) */
  area?: number
  owner?: OwnerKind
}

export interface RoadCheck {
  /** 진입로로 쓸 도로·구거 지번(PNU) */
  picked: string[]
  /** 도로 폭(m) */
  width?: number
  /** 부지가 도로에 닿는 길이(m) */
  frontage?: number
  /** 부지에서 도로까지 거리(m), 직접 닿으면 0 */
  gap?: number
  paved?: 'yes' | 'no'
  /** 지자체 조례의 진입로 최소 폭(m) */
  minWidth: number
}

export type SupplyLine = 'overhead' | 'underground'
export interface GridCheck {
  /** 공개 여유용량(kW). 비워 두면 미확인 */
  substation?: number
  transformer?: number
  feeder?: number
  /** 지도에서 찍은 가장 가까운 3상 전주 [경도, 위도] */
  pole?: [number, number]
  /** 직접 잰 전주 거리(m). 있으면 지도 거리보다 먼저 쓴다 */
  poleDistance?: number
  poleNo: string
  line: SupplyLine
  /** 초과 거리 공사비 단가(원/m) */
  overheadWonPerM: number
  undergroundWonPerM: number
}

export interface ForestCheck {
  /** 입목축적: 관할 시·군 평균 대비 % */
  stockPct?: number
  /** 평균경사(°)를 직접 넣을 때. 비우면 지형 분석값 */
  slopeDeg?: number
}

export interface SiteCheck {
  kind: SiteKind
  land: LandOverride
  road: RoadCheck
  grid: GridCheck
  forest: ForestCheck
}

export const DEFAULT_SITE_CHECK: SiteCheck = {
  kind: 'land',
  land: {},
  road: { picked: [], minWidth: 4 },
  grid: { poleNo: '', line: 'overhead', overheadWonPerM: 50000, undergroundWonPerM: 80000 },
  forest: {},
}

/** 저장본을 기본값과 합친다(이전 저장본에 없는 칸 채우기). */
export const mergeSiteCheck = (s?: Partial<SiteCheck>): SiteCheck => ({
  ...DEFAULT_SITE_CHECK,
  ...s,
  land: { ...s?.land },
  road: { ...DEFAULT_SITE_CHECK.road, ...s?.road },
  grid: { ...DEFAULT_SITE_CHECK.grid, ...s?.grid },
  forest: { ...s?.forest },
})

// ── 거리 ──

/** 두 다각형(경위도 링 목록) 사이 최단 거리(m). 겹치거나 닿으면 0. */
export function ringsDistance(a: number[][][], b: number[][][], frame = LocalFrame.around(a)): number {
  const A = a.map((r) => r.map((p) => frame.toLocal(p)))
  const B = b.map((r) => r.map((p) => frame.toLocal(p)))
  if (A.some((ra) => ra.some((p) => B.some((rb) => pointInRing(p, rb)))) || B.some((rb) => rb.some((p) => A.some((ra) => pointInRing(p, ra))))) return 0
  let best = Infinity
  for (const ra of A)
    for (const rb of B)
      for (let i = 0; i + 1 < ra.length; i++) for (let j = 0; j + 1 < rb.length; j++) best = Math.min(best, segSegDist(ra[i], ra[i + 1], rb[j], rb[j + 1]))
  return best
}

/** 점에서 부지 경계까지 거리(m). 부지 안이면 0. */
export function pointToRings(pt: number[], rings: number[][][]): number {
  const frame = LocalFrame.around(rings)
  const p = frame.toLocal(pt)
  const R = rings.map((r) => r.map((q) => frame.toLocal(q)))
  if (R.some((r) => pointInRing(p, r))) return 0
  let best = Infinity
  for (const r of R) for (let i = 0; i + 1 < r.length; i++) best = Math.min(best, segSegDist(p, p, r[i], r[i + 1]))
  return best
}

/** 부지와 맞닿은 길이(m): 부지 경계 중 상대 다각형에서 tol 이내인 구간의 합 */
export function sharedEdge(site: number[][][], other: number[][][], tol = 0.6): number {
  const frame = LocalFrame.around(site)
  const S = site.map((r) => r.map((p) => frame.toLocal(p)))
  const O = other.map((r) => r.map((p) => frame.toLocal(p)))
  const near = (p: Vec) => O.some((r) => r.some((_, i) => i + 1 < r.length && segSegDist(p, p, r[i], r[i + 1]) <= tol))
  let len = 0
  for (const r of S)
    for (let i = 0; i + 1 < r.length; i++) {
      const [a, b] = [r[i], r[i + 1]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.max(1, Math.ceil(L / 1))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        if (near([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) len += L / n
      }
    }
  return len
}

/** 길쭉한 도로 필지의 폭 추정: 2 × 면적 ÷ 둘레 */
export function stripWidth(rings: number[][][], area: number): number {
  const frame = LocalFrame.around(rings)
  let per = 0
  for (const r of rings)
    for (let i = 0; i + 1 < r.length; i++) {
      const [a, b] = [frame.toLocal(r[i]), frame.toLocal(r[i + 1])]
      per += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
  return per > 0 ? (2 * area) / per : 0
}

// ── 판정 ──

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

export function landReview(land: string | undefined, zoning: string[], owner: OwnerKind | undefined, kind: SiteKind): SectionReview {
  const checks: string[] = []
  let verdict: Verdict = land ? 'ok' : 'info'
  const worse = (v: Verdict) => {
    const rank = { info: 0, ok: 1, warn: 2, bad: 3 }
    if (rank[v] > rank[verdict]) verdict = v
  }
  if (isFarmland(land)) {
    worse('warn')
    checks.push('농지입니다. 농업진흥구역이면 염해농지 등 예외 말고는 설치가 어렵고, 그 밖은 농지전용(또는 타용도 일시사용) 허가가 필요합니다.')
  }
  if (isForest(land)) {
    worse('warn')
    checks.push('임야입니다. 산지일시사용 허가 대상이며 평균경사·입목축적 기준을 함께 봐야 합니다.')
  }
  if (zoning.some((z) => /자연환경보전|개발제한|보전녹지/.test(z))) {
    worse('bad')
    checks.push(`용도지역(${zoning.join(', ')})은 발전시설이 제한되는 곳입니다. 토지이음에서 행위제한을 먼저 확인하세요.`)
  } else if (zoning.some((z) => /농림지역|보전관리/.test(z))) {
    worse('warn')
    checks.push(`${zoning.join(', ')}: 지자체 조례에 따라 허용 여부와 이격거리가 다릅니다.`)
  }
  if (!zoning.length) checks.push('용도지역을 확인하지 못했습니다. 토지이음에서 토지이용계획을 확인하세요.')
  if (owner === 'public') {
    worse('warn')
    checks.push('국공유지입니다. 사용 허가나 대부 계약이 먼저 필요합니다.')
  }
  if (kind !== 'land') checks.push('건물 설치는 구조안전 확인(구조기술사 검토)과 건축물 용도별 기준을 따로 확인하세요.')
  const summary = [land ? `지목 ${land}` : '지목 미확인', zoning.length ? zoning.join(', ') : '용도지역 미확인', owner ? OWNER_KIND[owner] : null].filter(Boolean).join(' · ')
  return { key: 'land', title: '토지', verdict, summary, checks }
}

export interface RoadEval {
  review: SectionReview
  /** 0~100 */
  score: number | null
}

export function roadReview(r: RoadCheck): RoadEval {
  const known = r.gap !== undefined || r.width !== undefined
  if (!known)
    return {
      review: { key: 'road', title: '도로 접면', verdict: 'info', summary: '진입로를 확인하지 않았습니다.', checks: ['주변 도로를 조회해 진입로로 쓸 지번을 고르거나 폭·거리를 직접 넣으세요.'] },
      score: null,
    }
  const checks: string[] = []
  let score = 100
  if ((r.gap ?? 0) > 0.5) {
    score = 0
    checks.push(`가장 가까운 도로까지 ${fmt(r.gap!, 1)} m 떨어져 있습니다. 사이 땅의 사용승낙이나 매입으로 진입로를 먼저 확보해야 합니다.`)
  }
  if (r.width !== undefined && r.width < r.minWidth) {
    score = Math.min(score, r.width >= r.minWidth * 0.75 ? 60 : 30)
    checks.push(`도로 폭 ${fmt(r.width, 1)} m로 기준 ${fmt(r.minWidth, 1)} m보다 좁습니다. 확폭 계획이나 조례의 완화 조건을 확인하세요.`)
  }
  if (r.frontage !== undefined && r.frontage < 2 && (r.gap ?? 0) <= 0.5) {
    score = Math.min(score, 60)
    checks.push(`도로에 닿는 길이가 ${fmt(r.frontage, 1)} m로 짧습니다. 공사 차량 진입이 가능한지 현장에서 확인하세요.`)
  }
  if (r.paved === 'no') {
    score = Math.min(score, 80)
    checks.push('비포장 도로입니다. 공사 차량 통행과 포장 여부를 지자체와 협의하세요.')
  }
  const verdict: Verdict = score >= 85 ? 'ok' : score >= 50 ? 'warn' : 'bad'
  const parts = [r.gap !== undefined ? ((r.gap ?? 0) <= 0.5 ? '도로에 직접 접함' : `도로까지 ${fmt(r.gap, 1)} m`) : null, r.width !== undefined ? `폭 ${fmt(r.width, 1)} m` : null]
  return { review: { key: 'road', title: '도로 접면', verdict, summary: parts.filter(Boolean).join(', '), checks }, score }
}

/** 한전 공중(가공)·지중 공급의 기본 거리(m). 이를 넘는 거리는 고객이 공사비를 낸다. */
export const BASE_DISTANCE: Record<SupplyLine, number> = { overhead: 200, underground: 50 }

export interface GridEval {
  review: SectionReview
  /** 전주까지 거리(m) */
  distance: number | null
  /** 기본 거리를 넘는 공사비 추정(만원) */
  extraCost: number | null
  /** 확인한 여유용량 중 가장 작은 값(kW) */
  minRemaining: number | null
}

export function gridReview(g: GridCheck, needKW: number | null, rings: number[][][] | null): GridEval {
  const distance = g.poleDistance ?? (g.pole && rings ? pointToRings(g.pole, rings) : null)
  const over = distance === null ? null : Math.max(0, distance - BASE_DISTANCE[g.line])
  const extraCost = over === null ? null : (over * (g.line === 'overhead' ? g.overheadWonPerM : g.undergroundWonPerM)) / 10000
  const caps = [g.substation, g.transformer, g.feeder].filter((v): v is number => v !== undefined)
  const minRemaining = caps.length ? Math.min(...caps) : null
  const checks: string[] = []
  let verdict: Verdict = 'info'
  if (minRemaining !== null) {
    if (minRemaining <= 0) {
      verdict = 'bad'
      checks.push('공개 여유용량이 없습니다. 접속 대기·보류 가능성이 있어 한전 사전기술검토를 먼저 받아야 합니다.')
    } else if (needKW !== null && minRemaining < needKW) {
      verdict = 'warn'
      checks.push(`여유용량 ${fmt(minRemaining)} kW가 연계 용량 ${fmt(needKW)} kW보다 작습니다. 용량을 나누거나 출력제어 조건부 접속을 검토하세요.`)
    } else verdict = caps.length === 3 ? 'ok' : 'warn'
    if (needKW === null && minRemaining > 0) checks.push('배치 전이라 연계 용량과 비교하지 못했습니다. 가설계 뒤 다시 보세요.')
    if (caps.length < 3 && minRemaining > 0) checks.push('변전소·주변압기·배전선로 세 곳 모두의 여유용량을 확인해야 판정이 확정됩니다.')
  } else checks.push('한전ON에서 변전소·주변압기·배전선로 여유용량을 조회해 넣으세요.')
  if (distance !== null && distance > 1000) {
    if (verdict === 'ok') verdict = 'warn'
    checks.push(`전주까지 ${fmt(distance)} m로 멀어 선로 공사비가 커집니다.`)
  }
  const summary = [
    minRemaining === null ? '여유용량 미확인' : `최소 여유 ${fmt(minRemaining)} kW`,
    distance === null ? '전주 거리 미확인' : `전주까지 ${fmt(distance)} m`,
  ].join(', ')
  return { review: { key: 'grid', title: '계통연계', verdict, summary, checks }, distance, extraCost, minRemaining }
}

/** 산지 태양광 기준: 평균경사 15° 이하, 입목축적 관할 평균의 150% 이하 */
export function forestReview(f: ForestCheck, terrainSlopeDeg: number | null): SectionReview {
  const slope = f.slopeDeg ?? terrainSlopeDeg
  const checks: string[] = []
  let verdict: Verdict = 'ok'
  if (slope === null) {
    verdict = 'info'
    checks.push('평균경사를 모릅니다. 지형 분석을 하거나 직접 넣으세요.')
  } else if (slope > 15) {
    verdict = 'bad'
    checks.push(`평균경사 ${fmt(slope, 1)}°로 기준 15°를 넘습니다.`)
  }
  if (f.stockPct === undefined) {
    if (verdict === 'ok') verdict = 'info'
    checks.push('입목축적을 모릅니다. 산림공간정보의 임상도와 관할 평균을 확인하세요.')
  } else if (f.stockPct > 150) {
    verdict = 'bad'
    checks.push(`입목축적이 관할 평균의 ${fmt(f.stockPct)}%로 기준 150%를 넘습니다.`)
  }
  const summary = [slope === null ? '경사 미확인' : `평균경사 ${fmt(slope, 1)}°`, f.stockPct === undefined ? '입목축적 미확인' : `입목축적 ${fmt(f.stockPct)}%`].join(', ')
  return { key: 'forest', title: '산지 기준', verdict, summary, checks }
}

export function terrainReview(slopeDeg: number | null): SectionReview {
  if (slopeDeg === null) return { key: 'terrain', title: '지형', verdict: 'info', summary: '지형을 분석하지 않았습니다.', checks: ['지형 화면에서 경사와 절·성토량을 확인하세요.'] }
  const verdict: Verdict = slopeDeg > 15 ? 'bad' : slopeDeg > 10 ? 'warn' : 'ok'
  return {
    key: 'terrain',
    title: '지형',
    verdict,
    summary: `평균 경사 ${fmt(slopeDeg, 1)}°`,
    checks: verdict === 'ok' ? [] : [`평균 경사 ${fmt(slopeDeg, 1)}°로 정지 공사와 배수 계획이 필요합니다.`],
  }
}

// ── 주변 도로·구거 ──

export interface RoadCandidate {
  pnu: string
  /** 지번(예: 1364도) */
  label: string
  kind: '도로' | '구거'
  rings: number[][][]
  /** 부지까지 거리(m) */
  distance: number
  /** 추정 폭(m) */
  width: number
  /** 부지와 맞닿은 길이(m) */
  frontage: number
}

/** 부지 둘레를 margin(m)만큼 넓힌 경위도 사각형 [minLon, minLat, maxLon, maxLat] */
export function searchBox(rings: number[][][], margin: number): [number, number, number, number] {
  const frame = LocalFrame.around(rings)
  const pts = rings.flat().map((p) => frame.toLocal(p))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [a, b] = [frame.toLonLat([Math.min(...xs) - margin, Math.min(...ys) - margin]), frame.toLonLat([Math.max(...xs) + margin, Math.max(...ys) + margin])]
  return [a[0], a[1], b[0], b[1]]
}

/** 주변 필지 중 지목이 도로·구거인 것을 부지에서 가까운 순으로 */
export function nearbyRoads(
  site: number[][][],
  sitePnus: string[],
  parcels: Array<{ pnu: string; jibun: string; rings: number[][][]; area: number }>,
  limit = 8,
): RoadCandidate[] {
  const frame = LocalFrame.around(site)
  return parcels
    .filter((p) => !sitePnus.includes(p.pnu) && /(도|구)$/.test(p.jibun.trim()))
    .map((p) => {
      const distance = ringsDistance(site, p.rings, frame)
      return {
        pnu: p.pnu,
        label: p.jibun.trim().replace(/\s+/g, ''),
        kind: p.jibun.trim().endsWith('도') ? ('도로' as const) : ('구거' as const),
        rings: p.rings,
        distance,
        width: stripWidth(p.rings, p.area),
        frontage: distance <= 0.6 ? sharedEdge(site, p.rings) : 0,
      }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

/** 수배전반 기준으로 삼을 도로까지의 거리 한도(m). 사이에 구거·좁은 땅이 낀 정도까지 본다. */
const ROAD_ANCHOR_REACH = 20

/**
 * 전주 위치를 모를 때 수배전반을 붙일 기준점. 배전선로는 대개 도로를 따라가고 한전 계량·유지보수도 도로에서 드나들므로
 * 고른 도로(없으면 가까운 도로 중 접면이 가장 긴 것, 접면이 없으면 가장 가까운 것)에서 부지 가운데에 가장 가까운 점을 쓴다.
 * 가까운 도로가 없으면 null.
 */
export function roadAnchor(site: number[][][], cands: RoadCandidate[], picked: string[]): Vec | null {
  const chosen = cands.filter((c) => picked.includes(c.pnu))
  const near = cands.filter((c) => c.kind === '도로' && c.distance <= ROAD_ANCHOR_REACH)
  const pool = chosen.length ? chosen : near
  if (!pool.length) return null
  const road = pool.reduce((b, c) => (c.frontage > b.frontage || (c.frontage === b.frontage && c.distance < b.distance) ? c : b))
  const frame = LocalFrame.around(site)
  const pts = site.flatMap((ring) => ring.slice(0, -1)).map((p) => frame.toLocal(p))
  const center: Vec = [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length]
  let best: Vec | null = null
  let bestD = Infinity
  for (const ring of road.rings) {
    const r = ring.map((p) => frame.toLocal(p))
    for (let i = 0; i < r.length - 1; i++) {
      const [a, b] = [r[i], r[i + 1]]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / len2)) : 0
      const q: Vec = [a[0] + dx * t, a[1] + dy * t]
      const d = Math.hypot(q[0] - center[0], q[1] - center[1])
      if (d < bestD) [best, bestD] = [q, d]
    }
  }
  return best && frame.toLonLat(best)
}

/** 고른 도로들로 진입로 값을 채운다: 거리는 가장 가까운 것, 폭은 그중 가장 넓은 것, 접면 길이는 합 */
export function roadFromPicked(cands: RoadCandidate[], picked: string[]): Pick<RoadCheck, 'gap' | 'width' | 'frontage'> | null {
  const sel = cands.filter((c) => picked.includes(c.pnu))
  if (!sel.length) return null
  return {
    gap: Math.min(...sel.map((c) => c.distance)),
    width: Math.max(...sel.map((c) => c.width)),
    frontage: sel.reduce((a, c) => a + c.frontage, 0),
  }
}
