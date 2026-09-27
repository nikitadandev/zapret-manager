import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownToLine, Check, ChevronDown, CircleHelp, ExternalLink,
  FolderOpen, Gauge, Github, LoaderCircle, Power, RefreshCw, RotateCcw, Search,
  Settings, ShieldCheck, Sparkles, Square, WandSparkles, Wifi, X, Zap,
} from 'lucide-react'
import { averageLatency as getAverageLatency } from './utils'

const demoServices: ServiceProbe[] = [
  { id: 'youtube', name: 'YouTube', host: 'youtube.com', latency: 42, status: 'available' },
  { id: 'discord', name: 'Discord', host: 'discord.com', latency: 58, status: 'available' },
  { id: 'github', name: 'GitHub', host: 'github.com', latency: 71, status: 'available' },
  { id: 'telegram', name: 'Telegram', host: 'telegram.org', latency: 49, status: 'available' },
]

const defaultSnapshot: AppSnapshot = {
  platform: 'web', demoMode: true, installed: true, running: true,
  version: '1.10.3', latestVersion: '1.10.3', activeStrategy: 'General ALT 7',
  strategies: ['General', ...Array.from({ length: 13 }, (_, i) => `General ALT ${i + 1}`)],
  services: demoServices, lastChecked: new Date().toISOString(), enginePath: 'C:\\Users\\User\\AppData\\Roaming\\zapret-manager\\flowseal',
}

function localApi(): ManagerApi {
  let running = true
  let strategy = 'General ALT 7'
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const snapshot = () => Promise.resolve({ ...defaultSnapshot, running, activeStrategy: strategy })
  return {
    snapshot,
    status: snapshot,
    probe: async () => { await wait(500); return demoServices.map((item) => ({ ...item, latency: (item.latency || 40) + Math.round(Math.random() * 7) })) },
    start: async (next) => { await wait(450); running = true; strategy = next || strategy; return snapshot() },
    stop: async () => { await wait(450); running = false; return snapshot() },
    update: async () => { await wait(1200); return snapshot() },
    autoTune: async () => ({ index: 1, total: 1, strategy, bestStrategy: strategy, phase: 'complete', results: [{ strategy, score: 99, reachable: 4, averageLatency: 50 }] }),
    cancelTune: async () => true,
    getSettings: async () => ({ autoUpdate: true, startWithWindows: true, backgroundCheck: true }),
    updateSettings: async (settings) => ({ autoUpdate: true, startWithWindows: true, backgroundCheck: true, ...settings }),
    checkManagerUpdate: async () => ({ currentVersion: __APP_VERSION__, latestVersion: __APP_VERSION__, available: false, developmentMode: true }),
    downloadManagerUpdate: async () => ({ currentVersion: __APP_VERSION__, latestVersion: __APP_VERSION__, available: false, downloaded: true }),
    installManagerUpdate: async () => true,
    openEngineFolder: async () => defaultSnapshot.enginePath,
    openExternal: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    onTuneProgress: () => () => undefined,
    onBackgroundError: () => () => undefined,
    onStateChanged: () => () => undefined,
  }
}

const api = window.zapretManager || localApi()

const serviceGlyph: Record<string, string> = { youtube: 'YT', discord: 'DS', github: 'GH', telegram: 'TG' }

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(window.zapretManager ? { ...defaultSnapshot, demoMode: false, installed: false, running: false, version: null, latestVersion: null, activeStrategy: null, services: [], strategies: [] } : defaultSnapshot)
  const [loading, setLoading] = useState(true)
  const [probing, setProbing] = useState(true)
  const [action, setAction] = useState<'toggle' | 'update' | 'flowseal-check' | 'manager-check' | 'manager-download' | 'tune' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [tuneOpen, setTuneOpen] = useState(false)
  const [tune, setTune] = useState<TuneProgress>({ index: 0, total: 8, strategy: '', phase: 'starting' })
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [startWindows, setStartWindows] = useState(true)
  const [backgroundCheck, setBackgroundCheck] = useState(true)
  const [flowsealChecked, setFlowsealChecked] = useState(false)
  const [managerUpdate, setManagerUpdate] = useState<ManagerUpdateInfo | null>(null)
  const probePending = useRef(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const settingsCloseRef = useRef<HTMLButtonElement>(null)

  const runProbe = useCallback(async () => {
    if (probePending.current) return
    probePending.current = true
    setProbing(true)
    try {
      const services = await api.probe()
      setSnapshot((current) => ({ ...current, services, lastChecked: new Date().toISOString() }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось проверить сервисы')
    } finally { probePending.current = false; setProbing(false) }
  }, [])

  useEffect(() => {
    let alive = true
    api.snapshot().then((value) => {
      if (!alive) return
      setSnapshot((current) => ({ ...value, services: current.services }))
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false))
    runProbe()
    return () => { alive = false }
  }, [runProbe])

  useEffect(() => {
    if (!backgroundCheck || action === 'tune') return
    const timer = window.setInterval(runProbe, 30_000)
    return () => window.clearInterval(timer)
  }, [backgroundCheck, action, runProbe])

  useEffect(() => api.onBackgroundError(setError), [])

  useEffect(() => api.onTuneProgress((progress) => setTune(progress)), [])

  useEffect(() => api.onStateChanged((value) => setSnapshot((current) => ({ ...value, services: current.services }))), [])

  useEffect(() => {
    const refreshStatus = () => api.status().then((value) => {
      setSnapshot((current) => ({ ...value, services: current.services, latestVersion: current.latestVersion || value.latestVersion }))
    }).catch(() => undefined)
    const timer = window.setInterval(refreshStatus, 4000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    api.getSettings().then((settings) => {
      setAutoUpdate(settings.autoUpdate)
      setStartWindows(settings.startWithWindows)
      setBackgroundCheck(settings.backgroundCheck)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!settingsOpen && !tuneOpen) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>(tuneOpen ? '.tune-dialog' : '.settings-panel')
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])
    focusables()[0]?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      const first = items[0], last = items[items.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => { document.removeEventListener('keydown', trapFocus); previous?.focus() }
  }, [settingsOpen, tuneOpen])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (settingsOpen) setSettingsOpen(false)
      else if (profileOpen) setProfileOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [profileOpen, settingsOpen])

  const healthy = snapshot.services.filter((service) => (service.status === 'available' || service.status === 'slow')).length
  const averageLatency = useMemo(() => getAverageLatency(snapshot.services), [snapshot.services])
  const updateReady = !snapshot.installed || Boolean(snapshot.latestVersion && snapshot.version !== snapshot.latestVersion)
  const busy = loading || action !== null

  async function toggle() {
    setAction('toggle'); setError(null)
    try {
      const value = snapshot.running ? await api.stop() : await api.start(snapshot.activeStrategy || undefined)
      setSnapshot((current) => ({ ...value, services: current.services }))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить состояние') }
    finally { setAction(null) }
  }

  async function selectProfile(profile: string) {
    setProfileOpen(false); setAction('toggle')
    try {
      const value = await api.start(profile)
      setSnapshot((current) => ({ ...value, services: current.services }))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось запустить конфиг') }
    finally { setAction(null) }
  }

  async function checkFlowsealUpdate() {
    setAction('flowseal-check'); setError(null)
    try {
      const value = await api.snapshot()
      setSnapshot((current) => ({ ...value, services: current.services }))
      if (value.releaseError) throw new Error(value.releaseError)
      setFlowsealChecked(true)
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось проверить обновление Flowseal') }
    finally { setAction(null) }
  }

  async function updateFlowseal() {
    setAction('update'); setError(null)
    try {
      const value = await api.update()
      setSnapshot((current) => ({ ...value, services: current.services }))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось установить обновление') }
    finally { setAction(null) }
  }

  async function handleManagerUpdate() {
    setError(null)
    try {
      if (!managerUpdate || !managerUpdate.available) {
        setAction('manager-check')
        setManagerUpdate(await api.checkManagerUpdate())
      } else if (!managerUpdate.downloaded) {
        setAction('manager-download')
        setManagerUpdate(await api.downloadManagerUpdate())
      } else {
        await api.installManagerUpdate()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось проверить обновление менеджера')
    } finally { setAction(null) }
  }

  async function startTune() {
    if (busy) return
    setAction('tune')
    setTuneOpen(true)
    setTune({ index: 0, total: snapshot.strategies.length || 8, strategy: 'Подготовка', phase: 'starting' })
    try {
      const result = await api.autoTune()
      setTune(result)
      const value = await api.status()
      setSnapshot((current) => ({ ...value, services: current.services }))
      await runProbe()
    } catch (reason) {
      setTune((current) => ({ ...current, phase: 'error', message: reason instanceof Error ? reason.message : 'Ошибка проверки' }))
    } finally { setAction(null) }
  }

  async function cancelTune() {
    if (tune.phase === 'complete' || tune.phase === 'error' || tune.phase === 'cancelled') setTuneOpen(false)
    else {
      try { await api.cancelTune() } catch (reason) { setError(String(reason)) }
    }
  }

  async function changeSetting(key: keyof ManagerSettings, value: boolean) {
    if (savingSettings) return
    setSavingSettings(true)
    try {
      const settings = await api.updateSettings({ [key]: value })
      setAutoUpdate(settings.autoUpdate)
      setStartWindows(settings.startWithWindows)
      setBackgroundCheck(settings.backgroundCheck)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройку') }
    finally { setSavingSettings(false) }
  }

  function openExternal(url: string) {
    api.openExternal(url).catch((reason) => setError(String(reason)))
  }

  const progress = tune.total ? Math.round((tune.index / tune.total) * 100) : 0

  return (
    <div className="app-shell">
      <header className="titlebar" aria-label="Панель окна">
        <div className="brand"><Logo /><span>Zapret</span><span className="brand-muted">Manager</span></div>
        <div className="titlebar-drag" />
      </header>

      <aside className="rail" aria-label="Навигация">
        <div className="rail-main">
          <button className="rail-button active" aria-label="Главная" aria-current="page"><Gauge aria-hidden="true" /></button>
          <button className="rail-button" aria-label="Диагностика" onClick={startTune} disabled={busy}><Activity aria-hidden="true" /></button>
        </div>
        <div className="rail-bottom">
          <button className="rail-button" aria-label="Помощь" onClick={() => openExternal('https://github.com/Flowseal/zapret-discord-youtube/')}><CircleHelp aria-hidden="true" /></button>
          <button className="rail-button" aria-label="Настройки" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Settings aria-hidden="true" /></button>
          <div className="avatar" aria-label="Локальный пользователь">Я</div>
        </div>
      </aside>

      <main className="content" aria-busy={loading}>
        <section className="page-heading">
          <div>
            <div className="eyebrow"><span className={`live-dot ${snapshot.running ? 'online' : ''}`} /> {snapshot.running ? 'Защита активна' : 'Защита выключена'}</div>
            <h1>{snapshot.running ? 'Интернет работает свободнее' : 'Включите обход блокировок'}</h1>
            <p>{snapshot.running ? 'Zapret запущен и тихо работает в фоне.' : 'Выберите конфиг или доверьте подбор менеджеру.'}</p>
          </div>
          <div className="heading-meta">
            <div className="meta-label">Общий отклик</div>
            <div className="meta-value">{probing ? '—' : averageLatency ? `${averageLatency} мс` : 'нет данных'}</div>
          </div>
        </section>

        {snapshot.demoMode && (
          <div className="demo-banner" role="status"><ShieldCheck aria-hidden="true" /> Демонстрационный режим · реальные команды доступны в сборке для Windows</div>
        )}
        {error && (
          <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Скрыть ошибку"><X /></button></div>
        )}

        <section className={`hero-card ${snapshot.running ? 'is-running' : ''}`}>
          <div className="orb-wrap" aria-hidden="true">
            <div className="orb-rings"><span /><span /><span /></div>
            <div className="orb"><Zap /></div>
          </div>
          <div className="hero-copy">
            <div className="hero-kicker">ТЕКУЩИЙ РЕЖИМ</div>
            <h2>{snapshot.running ? 'Всё подключено' : 'Сейчас выключено'}</h2>
            <p>{snapshot.running ? `Работает конфиг ${snapshot.activeStrategy || 'General'}` : 'Нажмите большую кнопку — остальное сделаем мы.'}</p>
            <div className="hero-actions">
              <button className={`power-button ${snapshot.running ? 'stop' : ''}`} onClick={toggle} disabled={busy}>
                {action === 'toggle' ? <LoaderCircle className="spin" aria-hidden="true" /> : snapshot.running ? <Square fill="currentColor" aria-hidden="true" /> : <Power aria-hidden="true" />}
                {snapshot.running ? 'Остановить' : 'Включить'}
              </button>
              <div className="profile-picker">
                <button className="secondary-button" disabled={busy} onClick={() => setProfileOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={profileOpen}>
                  <span><span className="button-label">Конфиг</span>{snapshot.activeStrategy || 'Выбрать'}</span><ChevronDown aria-hidden="true" />
                </button>
                {profileOpen && (
                  <div className="profile-menu" role="listbox" aria-label="Выбор конфига">
                    {snapshot.strategies.map((profile) => (
                      <button key={profile} disabled={busy} role="option" aria-selected={profile === snapshot.activeStrategy} onClick={() => selectProfile(profile)}>
                        <span>{profile}</span>{profile === snapshot.activeStrategy && <Check aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="hero-stat">
            <span className="stat-icon"><Wifi aria-hidden="true" /></span>
            <div><strong>{healthy}/{snapshot.services.length || 4}</strong><span>сервисов доступны</span></div>
          </div>
        </section>

        <div className="section-line">
          <div><h2>Сервисы</h2><p>{backgroundCheck ? 'Проверяем автоматически каждые 30 секунд' : 'Автоматическая проверка выключена'}</p></div>
          <button className="quiet-button" onClick={runProbe} disabled={probing}><RefreshCw className={probing ? 'spin' : ''} aria-hidden="true" /> Проверить сейчас</button>
        </div>

        <section className="service-grid" aria-label="Доступность сервисов">
          {(snapshot.services.length ? snapshot.services : demoServices.map((item) => ({ ...item, status: 'checking' as ServiceStatus, latency: null }))).map((service) => (
            <article className="service-card" key={service.id}>
              <div className={`service-logo ${service.id}`} aria-hidden="true">{serviceGlyph[service.id]}</div>
              <div className="service-info"><h3>{service.name}</h3><span>{service.host}</span></div>
              <div className="service-result">
                <strong>{service.status === 'checking' ? '—' : service.latency ? `${service.latency} мс` : 'Нет связи'}</strong>
                <span className={`status ${service.status}`}><i />{service.status === 'available' ? 'Доступен' : service.status === 'slow' ? 'Медленно' : service.status === 'checking' ? 'Проверяем' : 'Недоступен'}</span>
              </div>
            </article>
          ))}
        </section>

        <section className="bottom-grid">
          <article className="smart-card">
            <div className="smart-icon"><WandSparkles aria-hidden="true" /></div>
            <div><span className="card-overline">УМНЫЙ ПОДБОР</span><h2>Найти лучший конфиг</h2><p>Проверим стратегии по очереди и оставим самую быструю для вашего провайдера.</p></div>
            <button className="primary-button" onClick={startTune} disabled={busy}><Search aria-hidden="true" /> Начать проверку</button>
          </article>
          <article className="update-card">
            <div className="update-top"><span className="card-overline">ОБНОВЛЕНИЯ</span><span className="version-badge muted">Вручную</span></div>
            <div className="update-row">
              <div><strong>Zapret и конфиги</strong><span>{snapshot.version ? `v${snapshot.version}` : 'Не установлен'}{flowsealChecked && !snapshot.releaseError && !updateReady ? ' · актуально' : ''}</span></div>
              <button onClick={updateReady ? updateFlowseal : checkFlowsealUpdate} disabled={busy}>
                {action === 'update' || action === 'flowseal-check' ? <LoaderCircle className="spin" /> : updateReady ? <ArrowDownToLine /> : <RefreshCw />}
                {!snapshot.installed ? 'Установить' : updateReady ? 'Обновить' : 'Проверить'}
              </button>
            </div>
            <div className="update-row">
              <div><strong>Zapret Manager</strong><span>v{__APP_VERSION__}{managerUpdate && !managerUpdate.available ? ' · актуально' : managerUpdate?.available ? ` → v${managerUpdate.latestVersion}` : ''}</span></div>
              <button onClick={handleManagerUpdate} disabled={busy}>
                {action === 'manager-check' || action === 'manager-download' ? <LoaderCircle className="spin" /> : managerUpdate?.available && !managerUpdate.downloaded ? <ArrowDownToLine /> : managerUpdate?.downloaded ? <RotateCcw /> : <RefreshCw />}
                {managerUpdate?.downloaded ? 'Перезапустить' : managerUpdate?.available ? 'Скачать' : 'Проверить'}
              </button>
            </div>
          </article>
        </section>

        <footer><span>Zapret Manager · {__APP_VERSION__}</span><button onClick={() => openExternal('https://github.com/Flowseal/zapret-discord-youtube/')}><Github /> Официальный Flowseal <ExternalLink /></button></footer>
      </main>

      {settingsOpen && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="panel-heading"><div><span className="card-overline">ПРИЛОЖЕНИЕ</span><h2 id="settings-title">Настройки</h2></div><button ref={settingsCloseRef} className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки"><X /></button></div>
            <div className="settings-group">
              <Toggle disabled={savingSettings} label="Автообновление" description="Устанавливать свежие конфиги Flowseal" value={autoUpdate} onChange={(value) => changeSetting('autoUpdate', value)} />
              <Toggle disabled={savingSettings} label="Запуск вместе с Windows" description="Открывать менеджер после входа в систему" value={startWindows} onChange={(value) => changeSetting('startWithWindows', value)} />
              <Toggle disabled={savingSettings} label="Фоновая диагностика" description="Проверять сервисы каждые 30 секунд" value={backgroundCheck} onChange={(value) => changeSetting('backgroundCheck', value)} />
            </div>
            <div className="source-card"><ShieldCheck /><div><strong>Безопасный источник</strong><span>Ядро загружается только из официального репозитория Flowseal и проверяется по SHA-256.</span></div></div>
            <button className="panel-link engine-folder" onClick={() => api.openEngineFolder().catch((reason) => setError(String(reason)))} title={snapshot.enginePath}><FolderOpen /> Открыть папку Zapret <span>{snapshot.enginePath}</span></button>
            <button className="panel-link" onClick={() => openExternal('https://github.com/Flowseal/zapret-discord-youtube/')}><Github /> Открыть репозиторий <ExternalLink /></button>
          </section>
        </div>
      )}

      {tuneOpen && (
        <div className="overlay tune-overlay">
          <section className="tune-dialog" role="dialog" aria-modal="true" aria-labelledby="tune-title">
            <div className="tune-visual" aria-hidden="true">
              {tune.phase === 'complete' ? <div className="complete-mark"><Check /></div> : tune.phase === 'error' ? <div className="complete-mark error"><X /></div> : <div className="scanner"><span /><Sparkles /></div>}
            </div>
            <span className="card-overline">АВТОНАСТРОЙКА</span>
            <h2 id="tune-title">{tune.phase === 'complete' ? 'Лучший конфиг найден' : tune.phase === 'cancelled' ? 'Проверка остановлена' : tune.phase === 'error' ? 'Не удалось завершить' : 'Подбираем лучший вариант'}</h2>
            <p className="tune-subtitle">{tune.phase === 'complete' ? `${tune.bestStrategy} уже запущен и готов к работе.` : tune.message || 'По очереди запускаем конфиги и проверяем доступность сервисов.'}</p>
            {tune.phase !== 'complete' && tune.phase !== 'error' && tune.phase !== 'cancelled' && (
              <>
                <div className="progress-meta"><span>{tune.strategy || 'Подготовка'}</span><strong>{tune.index} из {tune.total}</strong></div>
                <div className="progress-track" role="progressbar" aria-label="Прогресс проверки" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
                <div className="tune-note"><LoaderCircle className="spin" /> Не закрывайте приложение. Обычно это занимает 2–4 минуты.</div>
              </>
            )}
            {tune.phase === 'complete' && tune.results?.length && (
              <div className="winner-row"><div><span>Результат</span><strong>{tune.results[0].score}%</strong></div><div><span>Средний отклик</span><strong>{tune.results[0].averageLatency ?? '—'} мс</strong></div><div><span>Доступно</span><strong>{tune.results[0].reachable}/4</strong></div></div>
            )}
            <button className={tune.phase === 'complete' ? 'primary-button dialog-button' : 'quiet-button dialog-button'} onClick={cancelTune}>{tune.phase === 'complete' ? 'Готово' : tune.phase === 'error' || tune.phase === 'cancelled' ? 'Закрыть' : 'Остановить проверку'}</button>
          </section>
        </div>
      )}
    </div>
  )
}

function Logo() {
  return <span className="logo" aria-hidden="true"><span /><span /><span /></span>
}

function Toggle({ label, description, value, onChange, disabled }: { disabled?: boolean; label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" disabled={disabled} checked={value} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export default App
