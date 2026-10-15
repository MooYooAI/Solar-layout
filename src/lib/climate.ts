// 권역별 월평균 기온(°C, 1~12월). 기상청 평년값(1991~2020) 수준으로 반올림한 대표값이다.
// 모듈 온도 손실 계산에만 쓰므로 0.5°C 안팎의 차이는 발전량에 0.2% 정도밖에 영향을 주지 않는다.

export interface ClimateStation {
  id: string
  name: string
  lat: number
  lon: number
  temp: number[]
}

export const STATIONS: ClimateStation[] = [
  { id: 'seoul', name: '서울·경기', lat: 37.57, lon: 126.97, temp: [-1.9, 0.7, 6.1, 12.6, 17.9, 22.2, 24.9, 25.7, 21.2, 14.8, 7.2, 0.4] },
  { id: 'chuncheon', name: '강원 영서', lat: 37.9, lon: 127.74, temp: [-4.1, -1.2, 4.6, 11.6, 17.4, 21.9, 24.6, 24.9, 19.6, 12.3, 5.0, -2.3] },
  { id: 'gangneung', name: '강원 영동', lat: 37.75, lon: 128.89, temp: [0.9, 2.5, 6.6, 12.5, 17.0, 20.4, 23.9, 24.6, 20.4, 15.3, 9.2, 2.9] },
  { id: 'cheongju', name: '충북', lat: 36.64, lon: 127.44, temp: [-1.6, 0.9, 6.4, 12.9, 18.4, 22.6, 25.4, 25.9, 21.0, 14.4, 7.1, 0.5] },
  { id: 'daejeon', name: '대전·충남·세종', lat: 36.37, lon: 127.37, temp: [-0.9, 1.4, 6.6, 12.8, 18.2, 22.5, 25.4, 25.9, 21.1, 14.6, 7.6, 1.0] },
  { id: 'jeonju', name: '전북', lat: 35.82, lon: 127.15, temp: [-0.1, 2.0, 7.0, 13.2, 18.7, 22.9, 26.0, 26.4, 21.7, 15.2, 8.2, 1.8] },
  { id: 'gwangju', name: '광주·전남', lat: 35.17, lon: 126.89, temp: [0.6, 2.5, 7.4, 13.2, 18.6, 22.7, 26.0, 26.6, 22.1, 15.9, 9.1, 2.7] },
  { id: 'daegu', name: '대구·경북', lat: 35.88, lon: 128.62, temp: [0.6, 3.0, 8.0, 14.1, 19.4, 23.2, 26.1, 26.5, 21.7, 15.6, 8.6, 2.2] },
  { id: 'busan', name: '부산·울산·경남', lat: 35.1, lon: 129.03, temp: [3.6, 5.3, 9.1, 13.8, 17.9, 21.1, 24.5, 26.1, 22.6, 18.0, 11.8, 5.6] },
  { id: 'jeju', name: '제주', lat: 33.51, lon: 126.53, temp: [6.1, 6.9, 9.6, 14.0, 18.1, 21.7, 25.9, 27.0, 23.4, 18.8, 13.3, 8.3] },
]

/** 위경도에서 가장 가까운 권역 */
export function nearestStation(lat: number, lon: number): ClimateStation {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = STATIONS[0]
  let bestD = Infinity
  for (const s of STATIONS) {
    const d = (s.lat - lat) ** 2 + ((s.lon - lon) * k) ** 2
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

export interface TempModel {
  /** 월평균 기온(°C), 12개 */
  temp: number[]
  /** 최대출력 온도계수(%/°C), 결정질 실리콘 −0.3 ~ −0.45 */
  coeffPct: number
  /** 공칭 셀 작동 온도(°C) */
  noct: number
}

export const DEFAULT_TEMP_COEFF = -0.35
export const DEFAULT_NOCT = 45
/** 하루 기온 변화 진폭(°C). 15시 최고, 3시 최저인 코사인으로 근사한다. */
const DIURNAL_AMPLITUDE = 4

/**
 * 모듈 출력 온도 보정계수.
 * 셀 온도 = 기온 + (NOCT − 20) / 800 × 경사면 일사(W/㎡), 출력 = 1 + 계수 × (셀 온도 − 25).
 */
export function tempFactor(m: TempModel, month: number, solarHour: number, poaWm2: number): number {
  const tAmb = m.temp[month] + DIURNAL_AMPLITUDE * Math.cos((2 * Math.PI * (solarHour - 15)) / 24)
  const tCell = tAmb + ((m.noct - 20) / 800) * poaWm2
  return 1 + (m.coeffPct / 100) * (tCell - 25)
}
