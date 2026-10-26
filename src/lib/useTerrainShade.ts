import { useEffect, useRef, useState } from 'react'
import type { SunPos } from './sun'
import type { TerrainShadeImage, TerrainShader } from './terrainShadow'

/**
 * 해 위치를 따라 그림자 그림을 받아 온다. 그리는 동안 시각이 여러 번 바뀌면 마지막 것만 그리고,
 * 새 그림이 올 때까지 앞 그림을 그대로 둬서 시간 막대를 끌거나 재생해도 화면이 멈추지 않는다.
 */
export function useTerrainShade(shader: TerrainShader | null, sun: SunPos | null): TerrainShadeImage | null {
  const [state, setState] = useState<{ shader: TerrainShader; image: TerrainShadeImage | null } | null>(null)
  const mounted = useRef(false)
  const job = useRef<{ busy: boolean; want: { shader: TerrainShader; sun: SunPos } | null }>({ busy: false, want: null })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const az = sun?.azimuth
  const alt = sun?.altitude
  useEffect(() => {
    const j = job.current
    j.want = shader && az !== undefined && alt !== undefined ? { shader, sun: { azimuth: az, altitude: alt } } : null
    if (j.busy) return
    const pump = () => {
      const w = j.want
      j.want = null
      j.busy = !!w
      if (!w) return
      w.shader.render(w.sun).then((image) => {
        if (mounted.current) setState({ shader: w.shader, image })
        pump()
      })
    }
    pump()
  }, [shader, az, alt])
  return shader && sun && state?.shader === shader ? state.image : null
}
