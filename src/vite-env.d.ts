/// <reference types="vite/client" />

declare global {
type ServiceStatus = 'available' | 'slow' | 'unavailable' | 'checking'

interface ServiceProbe {
  id: string
  name: string
  host: string
  latency: number | null
  status: ServiceStatus
  detail?: string
}

interface AppSnapshot {
  platform: string
  demoMode: boolean
  installed: boolean
  running: boolean
  version: string | null
  latestVersion: string | null
  activeStrategy: string | null
  strategies: string[]
  services: ServiceProbe[]
  lastChecked: string
}

interface TuneProgress {
  index: number
  total: number
  strategy: string
  phase: 'starting' | 'testing' | 'complete' | 'cancelled' | 'error'
  score?: number
  bestStrategy?: string
  results?: Array<{ strategy: string; score: number; reachable: number; averageLatency: number | null }>
  message?: string
}

interface ManagerSettings {
  autoUpdate: boolean
  startWithWindows: boolean
  backgroundCheck: boolean
}

interface ManagerApi {
  snapshot: () => Promise<AppSnapshot>
  probe: () => Promise<ServiceProbe[]>
  start: (strategy?: string) => Promise<AppSnapshot>
  stop: () => Promise<AppSnapshot>
  update: () => Promise<AppSnapshot>
  autoTune: () => Promise<TuneProgress>
  cancelTune: () => Promise<boolean>
  getSettings: () => Promise<ManagerSettings>
  updateSettings: (settings: Partial<ManagerSettings>) => Promise<ManagerSettings>
  openExternal: (url: string) => Promise<void>
  onTuneProgress: (callback: (progress: TuneProgress) => void) => () => void
  onStateChanged: (callback: (snapshot: AppSnapshot) => void) => () => void
}

  interface Window { zapretManager?: ManagerApi }
}

export {}
