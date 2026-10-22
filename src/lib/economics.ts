// 경제성 검토: 연간 발전량과 판매 단가, 설치비, 융자 조건으로 해마다의 현금흐름을 만들고
// 회수기간·IRR·NPV를 계산한다. 세금(법인세·부가세)과 물가상승은 반영하지 않는다.
// 금액 단위는 만원, 단가는 원/kWh.

export type SaleMode = 'fixed' | 'spot'
export type Repayment = 'annuity' | 'equalPrincipal'
/** 목표 수익률을 자기자본 IRR로 볼지 사업 IRR로 볼지 */
export type IrrBasis = 'equity' | 'project'

export interface EconInput {
  kWp: number
  /** 1년차 발전량(kWh) */
  annualKWh: number
  /** kW당 설치비(만원/kW) */
  unitCost: number
  /** 판매 방식: 고정가격 계약(입찰·PPA) 또는 SMP+REC 현물 */
  saleMode: SaleMode
  /** 고정가격 계약 단가(원/kWh) */
  fixedPrice: number
  /** SMP(원/kWh) */
  smp: number
  /** REC 가격(원/REC, 1 REC = 1 MWh) */
  recPrice: number
  /** REC 가중치 */
  recWeight: number
  /** 연간 운영비(설치비 대비 %) */
  opexRate: number
  /** 연간 토지 임대료(만원) */
  landRent: number
  /** 연간 발전량 감소율(%) */
  degradation: number
  /** 분석 기간(년) */
  years: number
  /** 할인율(%) */
  discountRate: number
  /** 융자 비율(설치비 대비 %) */
  loanRatio: number
  /** 연 이자율(%) */
  loanRate: number
  /** 상환 기간(년, 거치 포함) */
  loanYears: number
  /** 거치 기간(년), 이자만 낸다 */
  graceYears: number
  repayment: Repayment
  /** 목표 IRR(%): 이 수익률을 맞추는 최대 설치비와 최저 판매 단가를 거꾸로 구한다 */
  targetIrr: number
  targetBasis: IrrBasis
  /** 대출기관이 요구하는 최소 DSCR */
  minDscr: number
  /** 총 설치비(만원)를 직접 주면 kWp × 설치단가 대신 쓴다(설계 기반 산출) */
  capex?: number
}

export type EconSettings = Omit<EconInput, 'kWp' | 'annualKWh' | 'capex'>

export const DEFAULT_ECON: EconSettings = {
  unitCost: 125,
  saleMode: 'fixed',
  fixedPrice: 150,
  smp: 110,
  recPrice: 72000,
  recWeight: 1.0,
  opexRate: 1.0,
  landRent: 0,
  degradation: 0.5,
  years: 20,
  discountRate: 5,
  loanRatio: 70,
  loanRate: 4.5,
  loanYears: 15,
  graceYears: 0,
  repayment: 'annuity',
  targetIrr: 8,
  targetBasis: 'equity',
  minDscr: 1.2,
}

/**
 * 태양광 REC 가중치 참고값(일반부지 기준 용량 구간, 임야는 0.5).
 * 건축물·수상 등은 다르므로 화면에서 직접 고칠 수 있게 한다.
 */
export function suggestRecWeight(kWp: number, landCategory?: string): number {
  if (landCategory === '임' || landCategory === '임야') return 0.5
  if (kWp < 100) return 1.2
  if (kWp <= 3000) return 1.0
  return 0.8
}

export interface LoanYear {
  year: number
  balance: number // 기초 잔액
  interest: number
  principal: number
}

export interface CashYear {
  year: number
  kWh: number
  revenue: number
  opex: number
  interest: number
  principal: number
  /** 자기자본 기준 현금흐름(매출 − 운영비 − 원리금) */
  equityFlow: number
  cumulative: number
  /** 원리금 상환능력 = (매출 − 운영비) ÷ 원리금. 상환이 없는 해는 null */
  dscr: number | null
}

export interface EconResult {
  capex: number
  loan: number
  equity: number
  /** 원/kWh, 1년차 판매 단가 */
  unitPrice: number
  flows: CashYear[]
  loanSchedule: LoanYear[]
  /** 자기자본 회수기간(년), 기간 안에 회수 못 하면 null */
  payback: number | null
  equityIrr: number | null
  projectIrr: number | null
  /** 자기자본 기준 NPV(만원) */
  npv: number
  /** 균등화 발전원가(원/kWh) */
  lcoe: number
  opex: number
  /** 상환 기간 중 가장 낮은 DSCR과 평균. 융자가 없으면 null */
  dscrMin: number | null
  dscrAvg: number | null
}

export function loanSchedule(amount: number, ratePct: number, years: number, grace: number, mode: Repayment): LoanYear[] {
  const out: LoanYear[] = []
  if (amount <= 0 || years <= 0) return out
  const r = ratePct / 100
  const g = Math.min(Math.max(0, Math.floor(grace)), years - 1)
  const n = years - g
  const annuity = r === 0 ? amount / n : (amount * r) / (1 - (1 + r) ** -n)
  let bal = amount
  for (let y = 1; y <= years; y++) {
    const interest = bal * r
    let principal = 0
    if (y > g) principal = mode === 'annuity' ? annuity - interest : amount / n
    if (y === years) principal = bal // 반올림 오차 정리
    out.push({ year: y, balance: bal, interest, principal })
    bal -= principal
  }
  return out
}

/** 현금흐름의 IRR(연). 부호가 한 번도 안 바뀌거나 범위 밖이면 null. */
export function irr(flows: number[]): number | null {
  const npvAt = (r: number) => flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0)
  let lo = -0.99
  let hi = 1.0
  let flo = npvAt(lo)
  const fhi = npvAt(hi)
  if (!Number.isFinite(flo) || flo * fhi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fm = npvAt(mid)
    if (Math.abs(fm) < 1e-7) return mid
    if (fm * flo < 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return (lo + hi) / 2
}

/**
 * 균등화 발전원가(LCOE, 원/kWh) = (설치비 + 운영비 현재가치 합) / (발전량 현재가치 합).
 * 설치비·운영비는 만원, 발전량은 1년차 kWh. 해마다 효율 감소를 반영한다.
 */
export function lcoe(capex: number, opexPerYear: number, annualKWh: number, degradationPct: number, years: number, discountPct: number): number {
  const d = discountPct / 100
  let cost = capex
  let energy = 0
  for (let y = 1; y <= years; y++) {
    const df = (1 + d) ** y
    cost += opexPerYear / df
    energy += (annualKWh * (1 - degradationPct / 100) ** (y - 1)) / df
  }
  return energy > 0 ? (cost * 10000) / energy : NaN
}

export function evaluate(i: EconInput): EconResult {
  const capex = i.capex ?? i.kWp * i.unitCost
  const loan = (capex * Math.min(100, Math.max(0, i.loanRatio))) / 100
  const equity = capex - loan
  const unitPrice = i.saleMode === 'fixed' ? i.fixedPrice : i.smp + (i.recPrice / 1000) * i.recWeight
  const schedule = loanSchedule(loan, i.loanRate, i.loanYears, i.graceYears, i.repayment)
  const opex = (capex * i.opexRate) / 100 + i.landRent

  const flows: CashYear[] = []
  const projectFlows = [-capex]
  const equityFlows = [-equity]
  let cumulative = -equity
  for (let y = 1; y <= i.years; y++) {
    const kWh = i.annualKWh * (1 - i.degradation / 100) ** (y - 1)
    const revenue = (kWh * unitPrice) / 10000
    const debt = schedule[y - 1]
    const interest = debt?.interest ?? 0
    const principal = debt?.principal ?? 0
    const equityFlow = revenue - opex - interest - principal
    cumulative += equityFlow
    const debtService = interest + principal
    const dscr = debtService > 1e-9 ? (revenue - opex) / debtService : null
    flows.push({ year: y, kWh, revenue, opex, interest, principal, equityFlow, cumulative, dscr })
    projectFlows.push(revenue - opex)
    equityFlows.push(equityFlow)
  }

  let payback: number | null = null
  let prev = -equity
  if (equity <= 0) payback = 0
  else
    for (const f of flows) {
      if (f.cumulative >= 0) {
        payback = f.year - 1 + -prev / (f.cumulative - prev)
        break
      }
      prev = f.cumulative
    }

  const dscrs = flows.map((f) => f.dscr).filter((v): v is number => v !== null)

  const d = i.discountRate / 100
  const npv = equityFlows.reduce((s, f, t) => s + f / (1 + d) ** t, 0)

  return {
    capex,
    loan,
    equity,
    unitPrice,
    flows,
    loanSchedule: schedule,
    payback,
    equityIrr: equity > 0 ? irr(equityFlows) : null,
    projectIrr: irr(projectFlows),
    npv,
    lcoe: lcoe(capex, opex, i.annualKWh, i.degradation, i.years, i.discountRate),
    opex,
    dscrMin: dscrs.length ? Math.min(...dscrs) : null,
    dscrAvg: dscrs.length ? dscrs.reduce((a, v) => a + v, 0) / dscrs.length : null,
  }
}

/** 목표 수익률로 할인한 NPV. 0보다 크면 IRR이 목표보다 높다. IRR과 달리 늘 계산되고 한 방향으로 변해 역산에 쓴다. */
function npvAtTarget(r: EconResult, basis: IrrBasis, rate: number): number {
  const equity = basis === 'equity' && r.equity > 0
  let v = equity ? -r.equity : -r.capex
  r.flows.forEach((f, t) => (v += (equity ? f.equityFlow : f.revenue - f.opex) / (1 + rate) ** (t + 1)))
  return v
}

/** f(x)가 x에 따라 한 방향으로 변할 때 f(x) = 0이 되는 x를 이분법으로 찾는다. */
function bisect(f: (x: number) => number, lo: number, hi: number): number | null {
  let flo = f(lo)
  const fhi = f(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (fm * flo <= 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return (lo + hi) / 2
}

export interface TargetSolve {
  /** 목표 IRR을 맞추는 최대 총 설치비(만원) */
  maxCapex: number | null
  /** 지금 설치비로 목표 IRR을 맞추는 최저 판매 단가(원/kWh) */
  minPrice: number | null
  /** 지금 설치비·단가에서 최소 DSCR을 지키는 최대 융자 비율(%) */
  maxLoanRatio: number | null
}

/** 목표 IRR·DSCR에서 거꾸로 푼다. */
export function solveTargets(i: EconInput): TargetSolve {
  const gap = (inp: EconInput) => npvAtTarget(evaluate(inp), i.targetBasis, i.targetIrr / 100)
  const base = i.capex ?? i.kWp * i.unitCost
  const maxCapex = base > 0 ? bisect((c) => gap({ ...i, capex: c }), base * 0.01, base * 10) : null
  const minPrice = bisect((p) => gap({ ...i, saleMode: 'fixed', fixedPrice: p }), 1, 2000)
  let maxLoanRatio: number | null = null
  const dscrAt = (ratio: number) => evaluate({ ...i, loanRatio: ratio }).dscrMin ?? Infinity
  if (dscrAt(100) >= i.minDscr) maxLoanRatio = 100
  else if (dscrAt(1) >= i.minDscr) maxLoanRatio = bisect((r) => dscrAt(r) - i.minDscr, 1, 100)
  else maxLoanRatio = 0
  return { maxCapex, minPrice, maxLoanRatio }
}

export interface SaleCompare {
  mode: SaleMode
  label: string
  result: EconResult
}

/** 같은 설치비·융자 조건에서 판매 방식만 바꿔 본다. */
export function compareSales(i: EconInput): SaleCompare[] {
  return [
    { mode: 'fixed', label: '고정가격 계약', result: evaluate({ ...i, saleMode: 'fixed' }) },
    { mode: 'spot', label: 'SMP + REC 현물', result: evaluate({ ...i, saleMode: 'spot' }) },
  ]
}
