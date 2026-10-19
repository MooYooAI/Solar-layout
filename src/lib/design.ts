// 배치 하나를 끝까지 평가한다: 전기 설계 → 음영·온도·클리핑·케이블 손실을 넣은 발전량 → 배치 토공량
// → 설계 기반 설치비 → LCOE·IRR·NPV·회수기간. AI 설계의 후보 비교와 현재 배치의 실시간 지표가 함께 쓴다.

import { buildScene, shadeTable, spreadSample, type ShadeQuality } from './analysis'
import { LocalFrame } from './geo'
import type { TempModel } from './climate'
import { capexFor, type Capex, type CostParams } from './costs'
import { layoutEarthwork, type EarthworkResult } from './earthwork'
import { designElectrical, type ElecParams, type ElecResult } from './electrical'
import type { ElevGrid } from './elevation'
import { evaluate as evaluateEcon, type EconSettings } from './economics'
import { KOREA_GHI, simulateEnergy, type EnergyResult, type MonthlyEnergy } from './energy'
import { layoutStats, setGeometry, type LayoutParams, type ModuleSet } from './layout'
import { parcelArea, type Parcel } from './parcel'
import type { Obstacle } from './shading'
import type { Horizon } from './horizon'

export interface DesignInput {
  parcel: Parcel
  params: LayoutParams
  sets: ModuleSet[]
  obstacles: Obstacle[]
  performanceRatio: number
  temperature?: TempModel
  elec: ElecParams
  costs: CostParams
  econ: EconSettings
  grid?: ElevGrid | null
  /** 주변 지형 지평선(있으면 산 그늘을 넣는다) */
  horizon?: Horizon | null
}

export interface DesignMetrics {
  sets: number
  modules: number
  kWp: number
  kWac: number
  dcAc: number
  inverters: number
  strings: number
  stringLen: number
  unusedModules: number
  coverage: number
  annualKWh: number
  specificYield: number
  shadeLoss: number
  clipLoss: number
  /** 발전량 기준 케이블 손실(0~1) */
  cableLoss: number
  /** 토공량(㎥). 표고를 불러오지 않았으면 null */
  cut: number | null
  fill: number | null
  capex: Capex
  capexPerKW: number
  lcoe: number
  projectIrr: number | null
  equityIrr: number | null
  npv: number
  payback: number | null
  monthly: EnergyResult['monthly']
}

export interface DesignResult {
  metrics: DesignMetrics
  elec: ElecResult | null
  earth: EarthworkResult | null
  energy: EnergyResult
}

/**
 * 성능계수(기본 0.86)에 이미 들어 있다고 보는 케이블 손실(발전량 기준).
 * 계산한 케이블 손실이 이보다 크거나 작으면 그 차이만큼 발전량을 고친다.
 */
const CABLE_LOSS_IN_PR = 0.01
/**
 * 정격 출력에서 계산한 저항 손실(%)을 연간 발전량 기준으로 바꾸는 계수.
 * 손실은 전류 제곱에 비례하고 대부분의 시간은 정격보다 낮은 출력이라 정격 손실의 약 60%가 된다.
 */
const RATED_TO_ENERGY = 0.6

export interface LayoutEnergyInput {
  rings: number[][][]
  sets: ModuleSet[]
  obstacles: Obstacle[]
  params: LayoutParams
  horizon: Horizon | null
  /** false면 음영 없이 계산 */
  shade: ShadeQuality | false
  /** 그늘 비율을 잴 세트 수 상한(전체 기준) */
  maxShadeSets?: number
  kWp: number
  acLimitKW?: number
  performanceRatio: number
  temperature?: TempModel
}

/**
 * 배치 전체의 발전량. 세트 방위각이 섞여 있으면(구역별 배치, 손으로 돌린 세트) 방위각마다 따로 계산해 더한다.
 * 그림자는 언제나 모든 세트·장애물이 드리우고, 그늘 비율은 그 방위각 세트에서만 잰다.
 * 설비 용량과 AC 한도는 세트 수 비율로 나눈다.
 */
export function layoutEnergy(i: LayoutEnergyInput): EnergyResult {
  const g = setGeometry(i.params)
  const groups = new Map<number, ModuleSet[]>()
  for (const s of i.sets) {
    const list = groups.get(s.azimuth)
    if (list) list.push(s)
    else groups.set(s.azimuth, [s])
  }
  if (!groups.size) groups.set(i.params.azimuth, [])
  const latDeg = LocalFrame.around(i.rings).lat0
  const parts = [...groups].map(([azimuth, list]) => {
    const share = i.sets.length ? list.length / i.sets.length : 1
    const max = i.maxShadeSets === undefined ? Infinity : Math.max(10, Math.round(i.maxShadeSets * share))
    const scene = i.shade && list.length ? buildScene(i.rings, i.sets, i.obstacles, i.params, g, spreadSample(list, max), i.horizon) : null
    return simulateEnergy({
      latDeg,
      tilt: i.params.tilt,
      azimuth,
      kWp: i.kWp * share,
      performanceRatio: i.performanceRatio,
      temperature: i.temperature,
      albedo: 0.2,
      ghi: KOREA_GHI,
      shade: scene && i.shade ? shadeTable(scene, i.shade) : undefined,
      acLimitKW: i.acLimitKW === undefined ? undefined : i.acLimitKW * share,
    })
  })
  return parts.length === 1 ? parts[0] : combineEnergy(parts, i.kWp)
}

function combineEnergy(parts: EnergyResult[], kWp: number): EnergyResult {
  const annualKWh = parts.reduce((s, x) => s + x.annualKWh, 0)
  const annualNoShade = parts.reduce((s, x) => s + x.annualNoShade, 0)
  const weight = (f: (x: EnergyResult) => number) =>
    annualNoShade ? parts.reduce((s, x) => s + f(x) * x.annualNoShade, 0) / annualNoShade : 0
  const monthly: MonthlyEnergy[] = parts[0].monthly.map((m, k) => {
    const kWhNoShade = parts.reduce((s, x) => s + x.monthly[k].kWhNoShade, 0)
    return {
      month: m.month,
      ghi: m.ghi,
      // 경사면 일사량은 발전량 비율로 평균한다.
      poa: kWhNoShade ? parts.reduce((s, x) => s + x.monthly[k].poa * x.monthly[k].kWhNoShade, 0) / kWhNoShade : m.poa,
      kWh: parts.reduce((s, x) => s + x.monthly[k].kWh, 0),
      kWhNoShade,
    }
  })
  return {
    monthly,
    annualKWh,
    annualNoShade,
    specificYield: kWp ? annualKWh / kWp : 0,
    shadeLoss: annualNoShade ? 1 - annualKWh / annualNoShade : 0,
    tempLoss: weight((x) => x.tempLoss),
    clipLoss: weight((x) => x.clipLoss),
  }
}

export interface EvalOptions {
  shade?: ShadeQuality
  /** 그늘 비율을 잴 세트 수 상한(고르게 뽑음). 큰 배치에서 계산 시간을 줄인다. */
  maxShadeSets?: number
}

export function evaluateDesign(d: DesignInput, o: EvalOptions = {}): DesignResult {
  const g = setGeometry(d.params)
  const stats = layoutStats(d.sets, g, parcelArea(d.parcel))
  const elec = designElectrical(d.parcel, d.sets, d.params, g, d.elec)
  const kWdc = elec?.kWdc ?? stats.kWp
  const energy = layoutEnergy({
    rings: d.parcel.rings,
    sets: d.sets,
    obstacles: d.obstacles,
    params: d.params,
    horizon: d.horizon ?? null,
    shade: o.shade ?? 'full',
    maxShadeSets: o.maxShadeSets,
    kWp: kWdc,
    acLimitKW: elec?.kWac,
    performanceRatio: d.performanceRatio,
    temperature: d.temperature,
  })
  const cableLoss = elec ? ((elec.dcLossPct + elec.acLossPct) / 100) * RATED_TO_ENERGY : CABLE_LOSS_IN_PR
  const k = (1 - cableLoss) / (1 - CABLE_LOSS_IN_PR)
  const monthly = energy.monthly.map((m) => ({ ...m, kWh: m.kWh * k, kWhNoShade: m.kWhNoShade * k }))
  const annualKWh = energy.annualKWh * k

  const earth = d.grid && d.sets.length ? layoutEarthwork(d.sets, d.params, g, d.grid) : null
  const capex = capexFor(kWdc, d.params.racking, elec, earth, d.costs)
  const econ = evaluateEcon({ ...d.econ, kWp: kWdc, annualKWh, capex: capex.total })

  return {
    elec,
    earth,
    energy: { ...energy, monthly, annualKWh, annualNoShade: energy.annualNoShade * k, specificYield: kWdc ? annualKWh / kWdc : 0 },
    metrics: {
      sets: stats.sets,
      modules: stats.modules,
      kWp: kWdc,
      kWac: elec?.kWac ?? 0,
      dcAc: elec?.dcAc ?? 0,
      inverters: elec?.inverters.length ?? 0,
      strings: elec?.strings.length ?? 0,
      stringLen: elec?.stringLen ?? 0,
      unusedModules: elec?.unusedModules ?? 0,
      coverage: stats.coverage,
      annualKWh,
      specificYield: kWdc ? annualKWh / kWdc : 0,
      shadeLoss: energy.shadeLoss,
      clipLoss: energy.clipLoss,
      cableLoss,
      cut: earth?.cut ?? null,
      fill: earth?.fill ?? null,
      capex,
      capexPerKW: kWdc ? capex.total / kWdc : 0,
      lcoe: econ.lcoe,
      projectIrr: econ.projectIrr,
      equityIrr: econ.equityIrr,
      npv: econ.npv,
      payback: econ.payback,
      monthly,
    },
  }
}
