// 입지검토 보고서의 판정 규칙. 화면 없이 숫자만 다룬다.
// 기준값은 공개된 법령·지침의 대표값이고, 지자체 조례와 최신 개정은 보고서에서 "확인 필요"로 따로 적는다.

import { LocalFrame, type Vec } from './geo'
import { KOREA_GHI, simulateEnergy } from './energy'
import type { Obstacle } from './shading'
import type { ModuleSet } from './layout'

export type Verdict = 'ok' | 'warn' | 'bad' | 'info'
export const VERDICT_LABEL: Record<Verdict, string> = { ok: '양호', warn: '검토', bad: '주의', info: '미확인' }

export interface SectionReview {
  key: string
  title: string
  verdict: Verdict
  /** 카드에 쓰는 한 줄 */
  summary: string
  /** 먼저 확인할 사항으로 올라가는 것 */
  checks: string[]
}

const SCORE: Record<Exclude<Verdict, 'info'>, number> = { ok: 100, warn: 65, bad: 25 }

/** 판정이 난 섹션만 평균 내 등급을 매긴다. 판정할 자료가 없는 섹션(미확인)은 빼고 따로 알린다. */
export function overallGrade(sections: SectionReview[]) {
  const scored = sections.filter((s) => s.verdict !== 'info')
  const score = scored.length ? Math.round(scored.reduce((a, s) => a + SCORE[s.verdict as Exclude<Verdict, 'info'>], 0) / scored.length) : 0
  const anyBad = scored.some((s) => s.verdict === 'bad')
  // 주의가 하나라도 있거나 검토가 둘 이상이면 B를 넘지 않는다.
  const raw = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D'
  const warns = scored.filter((s) => s.verdict === 'warn').length
  const grade = (anyBad || warns > 1) && raw === 'A' ? 'B' : raw
  const text: Record<string, string> = {
    A: '사업 추진에 큰 걸림돌이 보이지 않습니다.',
    B: '추진 가능해 보이나, 검토 항목을 먼저 확인해야 합니다.',
    C: '보완할 항목이 많습니다. 조건을 바꾼 대안과 함께 보세요.',
    D: '현재 조건으로는 사업성이 낮거나 인허가 위험이 큽니다.',
  }
  return { grade, score, text: text[grade], unknown: sections.length - scored.length }
}

export const isFarmland = (c?: string) => !!c && ['전', '답', '과', '과수원'].includes(c)
export const isForest = (c?: string) => c === '임' || c === '임야'

/** 경사(%) → 도 */
export const pctToDeg = (pct: number) => (Math.atan(pct / 100) * 180) / Math.PI

/** 연간 경사면 일사(정규화)를 경사각마다 구해 최적 경사각과 지금 설정의 효율을 낸다. */
export function tiltStudy(latDeg: number, tilt: number, azimuth: number) {
  const annual = (t: number, a: number) =>
    simulateEnergy({ latDeg, tilt: t, azimuth: a, kWp: 1, performanceRatio: 1, albedo: 0.2, ghi: KOREA_GHI }).annualKWh
  let best = 0
  let bestE = -1
  for (let t = 0; t <= 60; t++) {
    const e = annual(t, 0)
    if (e > bestE) {
      bestE = e
      best = t
    }
  }
  const tiltEff = annual(tilt, 0) / bestE
  const both = annual(tilt, azimuth) / bestE
  return { optimumTilt: best, tiltEff, azimuthEff: both / tiltEff, totalEff: both }
}

/** 정오 태양고도(도) */
export const noonAltitude = (latDeg: number, declDeg: number) => 90 - latDeg + declDeg

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
/** 로컬 벡터(동 +x, 북 +y)의 8방위 이름 */
export function direction8([x, y]: Vec): string {
  const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  return DIRS[Math.round(bearing / 45) % 8]
}

const centroid = (pts: Vec[]): Vec => {
  const n = Math.max(1, pts.length)
  return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n]
}

export interface ObstacleReview {
  name: string
  height: number
  distance: number
  direction: string
  winterShadow: number
  impact: Verdict
  impactText: string
}

/**
 * 장애물마다 배치 중심에서 본 방향·거리와 동지 정오 그림자 길이를 낸다.
 * 남쪽 반원에 있고 그림자가 가장 가까운 세트까지 닿으면 영향이 크다고 본다.
 */
export function reviewObstacles(rings: number[][][], sets: ModuleSet[], obstacles: Obstacle[], winterNoonAlt: number): ObstacleReview[] {
  const frame = LocalFrame.around(rings)
  const setPts = sets.map((s) => frame.toLocal([s.lon, s.lat]))
  const center = setPts.length ? centroid(setPts) : centroid(rings.flat().map((c) => frame.toLocal(c)))
  const tanAlt = Math.tan((Math.max(winterNoonAlt, 1) * Math.PI) / 180)
  return obstacles.map((o) => {
    const c = centroid(o.ring.slice(0, -1).map((p) => frame.toLocal(p)))
    const near = setPts.length ? Math.min(...setPts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) : Math.hypot(c[0] - center[0], c[1] - center[1])
    const dir = direction8([c[0] - center[0], c[1] - center[1]])
    const shadow = o.height / tanAlt
    const south = dir.startsWith('남') || ((dir === '동' || dir === '서') && c[1] < center[1])
    const impact: Verdict = south && shadow >= near ? 'bad' : south && shadow >= near * 0.6 ? 'warn' : 'ok'
    return {
      name: o.name,
      height: o.height,
      distance: near,
      direction: dir,
      winterShadow: shadow,
      impact,
      impactText: impact === 'bad' ? '겨울 그늘이 배치에 닿음' : impact === 'warn' ? '겨울 아침·저녁 영향 가능' : '영향 적음',
    }
  })
}

/** 설비용량 구간. 각 구간의 경계 바로 위에 있으면 줄였을 때 얻는 것을 알려 준다. */
export const CAPACITY_BANDS: Array<{ limit: number; note: string }> = [
  { limit: 100, note: '100kW 미만은 일반부지 REC 가중치 1.2를 받습니다.' },
  { limit: 500, note: '500kW 안팎에서 한전 연계 방식과 접속 검토 범위가 달라질 수 있어 한전 확인이 필요합니다.' },
  { limit: 1000, note: '1MW 이하는 안전관리 대행 범위 안에 들어 운영 부담이 비교적 작습니다.' },
  { limit: 3000, note: '3MW 이하는 시·도지사가 전기사업 허가를 내고, 넘으면 산업통상자원부(전기위원회)로 갑니다.' },
]

/** 경계를 조금(20% 안) 넘은 구간이 있으면 그 구간 */
export function capacityNearMiss(kWp: number) {
  return CAPACITY_BANDS.find((b) => kWp > b.limit && kWp <= b.limit * 1.2) ?? null
}

/** 전기사업 허가권자 */
export function licensingAuthority(kWp: number, address: string) {
  if (address.includes('제주')) return kWp > 3000 ? '산업통상자원부장관(전기위원회 심의)' : '제주특별자치도지사'
  return kWp > 3000 ? '산업통상자원부장관(전기위원회 심의)' : '관할 시·도지사'
}

/** 소규모 환경영향평가 대상 면적(㎡): 환경영향평가법 시행령 별표 4의 용도지역별 대표값 */
const SMALL_EIA: Array<[RegExp, number]> = [
  [/자연환경보전/, 5000],
  [/보전관리/, 5000],
  [/개발제한/, 5000],
  [/생산관리/, 7500],
  [/농림/, 7500],
  [/계획관리/, 10000],
  [/녹지/, 10000],
]

export function smallEia(area: number, zoning: string[]) {
  const limits = zoning.flatMap((z) => SMALL_EIA.filter(([re]) => re.test(z)).map(([, v]) => v))
  if (!limits.length) return { limit: null as number | null, applies: null as boolean | null }
  const limit = Math.min(...limits)
  return { limit, applies: area >= limit }
}

export interface PermitItem {
  name: string
  need: 'yes' | 'maybe' | 'no'
  basis: string
}

/** 지목·용도지역·면적으로 고른 필요 인허가 */
export function permitList(kWp: number, address: string, land: string | undefined, area: number, eia: boolean | null): PermitItem[] {
  return [
    { name: '발전사업(전기사업) 허가', need: 'yes', basis: `${licensingAuthority(kWp, address)} 허가` },
    { name: '개발행위 허가', need: 'yes', basis: '국토계획법. 지자체 조례의 이격·경사 기준 적용' },
    { name: '농지전용 허가(신고)', need: isFarmland(land) ? 'yes' : 'no', basis: isFarmland(land) ? `지목 ${land}. 농지보전부담금 부과` : '농지 아님' },
    { name: '산지일시사용 허가', need: isForest(land) ? 'yes' : 'no', basis: isForest(land) ? '임야. 평균경사 15° 이하, 사용 뒤 원상복구' : '임야 아님' },
    {
      name: '소규모 환경영향평가',
      need: eia === null ? 'maybe' : eia ? 'yes' : 'no',
      basis: eia === null ? '용도지역 확인 필요' : eia ? '용도지역별 대상 면적 이상' : '대상 면적 미만',
    },
    { name: '공사계획 인가·신고', need: 'yes', basis: '전기사업법. 사용 전 검사와 함께 진행' },
    { name: '한전 계통연계 신청', need: 'yes', basis: '접속 가능 용량 확인 후 신청' },
    { name: '경계복원 측량', need: area > 0 ? 'maybe' : 'no', basis: '경계가 불분명하거나 담장·펜스를 세울 때' },
  ]
}

/** 대략의 사업 일정(개월). 인허가는 평가 대상이면 길어지고, 공사는 용량에 따라 늘린다. */
export function schedule(kWp: number, eia: boolean | null, forest: boolean) {
  const permit = 3 + (eia ? 1 : 0) + (forest ? 1 : 0)
  const build = kWp > 3000 ? 4 : kWp > 1000 ? 3 : kWp > 300 ? 2 : 1
  return [
    { name: '사전 검토·계약', months: 1 },
    { name: '인허가', months: permit },
    { name: '한전 협의·착공 준비', months: 2 },
    { name: '시공', months: build },
    { name: '사용 전 검사·준공', months: 1 },
  ]
}
