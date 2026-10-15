import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages는 /저장소이름/ 아래에서 열리므로 상대 경로로 빌드한다.
  base: './',
})
