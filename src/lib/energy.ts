// 월평균 일사량으로 발전량을 계산한다.
// 수평면 일사량 → (Erbs) 산란 비율 → (Collares-Pereira & Rabl, Liu-Jordan) 시간별 분배
// → 경사면 일사량(등방성 하늘 모델) → 음영으로 가려진 직달분 차감 → (선택) 시간별 모듈 온도 손실 → 성능계수.

import { deg2rad } from './geo'
import { declination, sunPosition } from './sun'
import { tempFactor, type TempModel } from './climate'

/** 한국 평균 수평면 일일 일사량(kWh/㎡/일), 1~12월. 기상청 일사량 평년값 수준의 대표값. */
export const KOREA_GHI = [2.35, 3.15, 4.05, 4.9, 5.3, 4.95, 4.05, 4.25, 3.85, 3.35, 2.4, 2.05]

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** 각 달의 대표일(Klein) */
export const REP_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]

const GSC = 1.367 // kW/㎡

export interface EnergyOptions {
  latDeg: number
  tilt: number
  azimuth: number // 남 0, 서 +
  kWp: number
  /** 음영을 뺀 시스템 성능계수 (인버터, 온도, 배선 손실 등) */
  performanceRatio: number
  albedo: number
  ghi: number[]
  /**
   * 시간별 직달 음영 비율(0~1)을 돌려주는 함수. month 0~11, solarHour 태양시.
   * 없으면 음영 없음.
   */
  shade?: (month: number, solarHour: number) => number
  /** 있으면 시간마다 모듈 온도 손실을 따로 계산한다. 이때 성능계수에는 온도 외 손실만 넣는다. */
  temperature?: TempModel
}

export interface MonthlyEnergy {
  month: number
  ghi: number // kWh/㎡/월
  poa: number // kWh/㎡/월, 음영 전
  kWh: number // 음영 반영 발전량
  kWhNoShade: number
}

export interface EnergyResult {
  monthly: MonthlyEnergy[]
  annualKWh: number
  annualNoShade: number
  specificYield: number // kWh/kWp
  shadeLoss: number // 0~1
  /** 온도 손실(0~1, 음수면 이득). 온도 모델을 안 쓰면 0 */
  tempLoss: number
}

/** 하루 대기권 밖 수평면 일사량(kWh/㎡) */
function h0Daily(latRad: number, decRad: number, n: number): number {
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(decRad))))
  const e0 = 1 + 0.033 * Math.cos(deg2rad((360 * n) / 365))
  return (
    ((24 / Math.PI) * GSC * e0 *
      (Math.cos(latRad) * Math.cos(decRad) * Math.sin(ws) + ws * Math.sin(latRad) * Math.sin(decRad)))
  )
}

export function simulateEnergy(o: EnergyOptions): EnergyResult {
  const lat = deg2rad(o.latDeg)
  const beta = deg2rad(o.tilt)
  const gamma = deg2rad(o.azimuth)
  const monthly: MonthlyEnergy[] = []
  let poaTotal = 0
  let effTotal = 0

  for (let m = 0; m < 12; m++) {
    const n = REP_DAY[m]
    const decDeg = declination(n)
    const dec = deg2rad(decDeg)
    const H = o.ghi[m]
    const H0 = h0Daily(lat, dec, n)
    const KT = H / H0
    // Erbs 월평균 산란 비율 (ws ≤ 81.4°)
    const ws = Math.acos(-Math.tan(lat) * Math.tan(dec))
    const HdH =
      ws <= deg2rad(81.4)
        ? 1.391 - 3.56 * KT + 4.189 * KT ** 2 - 2.137 * KT ** 3
        : 1.311 - 3.022 * KT + 3.427 * KT ** 2 - 1.821 * KT ** 3
    const Hd = H * HdH
    const a = 0.409 + 0.5016 * Math.sin(ws - Math.PI / 3)
    const b = 0.6609 - 0.4767 * Math.sin(ws - Math.PI / 3)

    let poaDay = 0
    let poaShadedDay = 0
    // 온도 보정까지 곱한 값(온도 모델이 없으면 위와 같다)
    let effDay = 0
    let effShadedDay = 0
    const dt = 0.25
    for (let t = 12 - (ws * 12) / Math.PI + dt / 2; t < 12 + (ws * 12) / Math.PI; t += dt) {
      const w = deg2rad(15 * (t - 12))
      const denom = Math.sin(ws) - ws * Math.cos(ws)
      const rd = (Math.PI / 24) * ((Math.cos(w) - Math.cos(ws)) / denom)
      const rt = rd * (a + b * Math.cos(w))
      const I = Math.max(0, H * rt) * dt // 이 구간 수평면 전일사(kWh/㎡)
      const Id = Math.min(I, Math.max(0, Hd * rd) * dt)
      const Ib = I - Id
      const sun = sunPosition(o.latDeg, decDeg, t)
      const cosZ = Math.sin(sun.altitude)
      if (cosZ <= 0.02) continue
      // 경사면 입사각
      const cosTheta =
        Math.cos(sun.altitude) * Math.cos(sun.azimuth - gamma) * Math.sin(beta) + cosZ * Math.cos(beta)
      const Rb = Math.max(0, cosTheta) / cosZ
      const beamT = Ib * Math.min(Rb, 10)
      const diffT = (Id * (1 + Math.cos(beta))) / 2
      const reflT = (I * o.albedo * (1 - Math.cos(beta))) / 2
      const shade = o.shade ? o.shade(m, t) : 0
      const poa = beamT + diffT + reflT
      // 그림자가 진 모듈은 직달분을 잃고, 산란은 하늘이 일부 가려지는 만큼 약간 줄어든다(근사 5%).
      const poaShaded = beamT * (1 - shade) + diffT * (1 - 0.05 * shade) + reflT
      poaDay += poa
      poaShadedDay += poaShaded
      // dt시간 동안의 kWh/㎡ → 평균 W/㎡
      effDay += o.temperature ? poa * tempFactor(o.temperature, m, t, (poa / dt) * 1000) : poa
      effShadedDay += o.temperature ? poaShaded * tempFactor(o.temperature, m, t, (poaShaded / dt) * 1000) : poaShaded
    }
    const days = MONTH_DAYS[m]
    const kWhNoShade = effDay * days * o.kWp * o.performanceRatio
    monthly.push({
      month: m + 1,
      ghi: H * days,
      poa: poaDay * days,
      kWh: effShadedDay * days * o.kWp * o.performanceRatio,
      kWhNoShade,
    })
    poaTotal += poaDay * days
    effTotal += effDay * days
  }
  const annualKWh = monthly.reduce((s, x) => s + x.kWh, 0)
  const annualNoShade = monthly.reduce((s, x) => s + x.kWhNoShade, 0)
  return {
    monthly,
    annualKWh,
    annualNoShade,
    specificYield: o.kWp ? annualKWh / o.kWp : 0,
    shadeLoss: annualNoShade ? 1 - annualKWh / annualNoShade : 0,
    tempLoss: poaTotal ? 1 - effTotal / poaTotal : 0,
  }
}
