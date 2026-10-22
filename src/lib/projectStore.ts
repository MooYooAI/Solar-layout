// 프로젝트 저장·불러오기. 지금은 이 브라우저(localStorage)에 두고, 로그인이 생기면 같은 모양의
// 서버 저장소로 바꿔 끼운다. 그래서 모든 메서드를 비동기로 둔다.
import type { LayoutParams, ModuleSet } from './layout'
import type { Parcel } from './parcel'
import type { Obstacle } from './shading'
import type { ElecParams } from './electrical'
import type { CostParams } from './costs'
import type { EconSettings } from './economics'
import type { SiteCheck } from './siteCheck'
import type { BuildableOptions } from './buildable'
import type { GradingMode } from './terrain'
import type { Scenario } from '../components/OptimizePanel'
import type { DesignVersion, PermitProgress, PlantInfo, Tab } from './stages'

/** 다시 열면 그때 화면으로 돌아오는 데 필요한 값. 계산 결과는 넣지 않고 열 때 다시 계산한다. */
export interface ProjectData {
  parcel: Parcel
  params: LayoutParams
  sets: ModuleSet[]
  obstacles: Obstacle[]
  layoutMode?: string
  elec?: ElecParams
  costs?: CostParams
  econ?: EconSettings
  econHours?: number
  performanceRatio?: number
  tempOn?: boolean
  tempCoeff?: number
  stationId?: string
  withShade?: boolean
  buildOptions?: BuildableOptions
  useMask?: boolean
  gradingMode?: GradingMode
  maxDesignSlope?: number
  scenarios?: Scenario[]
  /** 확정한 설계 이력과 지금 기준인 확정본 */
  versions?: DesignVersion[]
  confirmedId?: string | null
  permits?: PermitProgress
  plant?: PlantInfo
  siteCheck?: Partial<SiteCheck>
  /** 마지막으로 보던 화면 */
  tab?: Tab
}

/** 목록에 보일 요약 */
export interface ProjectMeta {
  id: string
  name: string
  savedAt: number
  address: string
  sets: number
  kWp: number
}

export interface SavedProject extends ProjectMeta {
  data: ProjectData
}

/** 저장소 바꿔 끼우기용 경계. 로그인 서버 저장소도 이 모양을 따른다. */
export interface ProjectStore {
  /** 화면에 보일 저장 위치 이름 */
  readonly label: string
  list(): Promise<ProjectMeta[]>
  load(id: string): Promise<SavedProject | null>
  /** id가 있으면 덮어쓰고, 없으면 새로 만든다. */
  save(p: { id?: string; name: string; data: ProjectData; kWp: number }): Promise<ProjectMeta>
  remove(id: string): Promise<void>
}

const FILE_KIND = 'solar-layout-project'
const FILE_VERSION = 1

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const isData = (d: unknown): d is ProjectData => {
  const v = d as ProjectData | null
  return !!v && !!v.parcel && Array.isArray(v.parcel.rings) && !!v.params && Array.isArray(v.sets) && Array.isArray(v.obstacles)
}

const meta = (p: SavedProject): ProjectMeta => ({ id: p.id, name: p.name, savedAt: p.savedAt, address: p.address, sets: p.sets, kWp: p.kWp })

/** 이 브라우저에만 남는 저장소 */
export function localProjectStore(key = 'solar-projects'): ProjectStore {
  const read = (): SavedProject[] => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? '[]')
      return Array.isArray(v) ? v.filter((p) => p && p.id && isData(p.data)) : []
    } catch {
      return []
    }
  }
  const write = (list: SavedProject[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(list))
    } catch {
      throw new Error('브라우저 저장 공간이 모자랍니다. 안 쓰는 프로젝트를 지우거나 파일로 내보내 두세요.')
    }
  }
  return {
    label: '이 브라우저',
    async list() {
      return read()
        .map(meta)
        .sort((a, b) => b.savedAt - a.savedAt)
    },
    async load(id) {
      return read().find((p) => p.id === id) ?? null
    },
    async save({ id, name, data, kWp }) {
      const list = read()
      const p: SavedProject = { id: id ?? newId(), name, savedAt: Date.now(), address: data.parcel.address, sets: data.sets.length, kWp, data }
      const i = list.findIndex((x) => x.id === p.id)
      if (i >= 0) list[i] = p
      else list.push(p)
      write(list)
      return meta(p)
    },
    async remove(id) {
      write(read().filter((p) => p.id !== id))
    },
  }
}

/** 지금 쓰는 저장소. 로그인이 붙으면 여기서 서버 저장소를 돌려준다. */
export const projectStore: ProjectStore = localProjectStore()

/** 다른 컴퓨터로 옮기거나 보관할 파일 내용 */
export function projectToFile(name: string, data: ProjectData): string {
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, name, savedAt: Date.now(), data }, null, 1)
}

export function projectFromFile(text: string): { name: string; data: ProjectData } {
  let v: { kind?: string; name?: string; data?: unknown }
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error('프로젝트 파일을 읽지 못했습니다(JSON 형식이 아닙니다).')
  }
  if (v?.kind !== FILE_KIND || !isData(v.data)) throw new Error('이 앱에서 내보낸 프로젝트 파일이 아닙니다.')
  return { name: typeof v.name === 'string' && v.name ? v.name : v.data.parcel.address, data: v.data }
}
