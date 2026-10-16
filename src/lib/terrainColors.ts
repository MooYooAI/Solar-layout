import { SLOPE_BREAKS } from './terrain'

// 경사도: 한 색상(주황) 밝은→진한 5단계. 절성토: 절토 갈색 ↔ 회색 ↔ 성토 파랑.
export const SLOPE_COLORS = ['#fff1e6', '#fdc89b', '#f89a53', '#e8590c', '#a63c06']
export const SLOPE_LABELS = ['0~5%', '5~10%', '10~15%', '15~20%', '20% 이상']

export const CUTFILL_BREAKS = [-2, -1, -0.3, 0.3, 1, 2]
export const CUTFILL_COLORS = ['#7a3e12', '#b8692e', '#e3b48a', '#d9d9d9', '#9cc3e6', '#4a8fd1', '#1c5a9e']
export const CUTFILL_LABELS = ['절토 2m 이상', '절토 1~2m', '절토 0.3~1m', '±0.3m', '성토 0.3~1m', '성토 1~2m', '성토 2m 이상']

export const slopeClass = (pct: number) => SLOPE_BREAKS.filter((b) => pct >= b).length
export const cutFillClass = (dz: number) => CUTFILL_BREAKS.filter((b) => dz >= b).length
