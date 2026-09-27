import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownToLine, Check, ChevronDown, CircleHelp, ExternalLink,
  Gauge, Github, LoaderCircle, Play, Power, RefreshCw, RotateCcw, Search,
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
  services: demoServices, lastChecked: new Date().toISOString(),
}

function localApi(): ManagerApi {
  let running = true
  let strategy = 'General ALT 7'
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const snapshot = () => Promise.resolve({ ...defaultSnapshot, running, activeStrategy: strategy })
  return {
    snapshot,
    probe: async () => { await wait(500); return demoServices.map((item) => ({ ...item, latency: (item.latency || 40) + Math.round(Math.random() * 7) })) },
    start: async (next) => { await wait(450); running = true; strategy = next || strategy; return snapshot() },
    stop: async () => { await wait(450); running = false; return snapshot() },
    update: async () => { await wait(1200); return snapshot() },
    autoTune: async () => ({ index: 0, total: 0, strategy: '', phase: 'complete' }),
    cancelTune: async () => true,
    getSettings: async () => ({ autoUpdate: true, startWithWindows: true, backgroundCheck: true }),
    updateSettings: async (settings) => ({ autoUpdate: true, startWithWindows: true, backgroundCheck: true, ...settings }),
    openExternal: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    onTuneProgress: () => () => undefined,
    onStateChanged: () => () => undefined,
  }
}

const api = window.zapretManager || localApi()

const serviceGlyph: Record<string, string> = { youtube: 'YT', discord: 'DS', github: 'GH', telegram: 'TG' }

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(defaultSnapshot)
  const [loading, setLoading] = useState(true)
  const [probing, setProbing] = useState(true)
  const [action, setAction] = useState<'toggle' | 'update' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [tuneOpen, setTuneOpen] = useState(false)
  const [tune, setTune] = useState<TuneProgress>({ index: 0, total: 8, strategy: '', phase: 'starting' })
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [startWindows, setStartWindows] = useState(true)
  const [backgroundCheck, setBackgroundCheck] = useState(true)
  const settingsCloseRef = useRef<HTMLButtonElement>(null)

  const runProbe = useCallback(async () => {
    setProbing(true)
    try {
      const services = await api.probe()
      setSnapshot((current) => ({ ...current, services, lastChecked: new Date().toISOString() }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось проверить сервисы')
    } finally { setProbing(false) }
  }, [])

  useEffect(() => {
    let alive = true
    api.snapshot().then((value) => {
      if (!alive) return
      setSnapshot((current) => ({ ...value, services: current.services }))
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false))
    runProbe()
    const timer = window.setInterval(() => { if (backgroundCheck) runProbe() }, 30_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [backgroundCheck, runProbe])

  useEffect(() => api.onTuneProgress((progress) => setTune(progress)), [])

  useEffect(() => api.onStateChanged((value) => setSnapshot((current) => ({ ...value, services: current.services }))), [])

  useEffect(() => {
    api.getSettings().then((settings) => {
      setAutoUpdate(settings.autoUpdate)
      setStartWindows(settings.startWithWindows)
      setBackgroundCheck(settings.backgroundCheck)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (settingsOpen) requestAnimationFrame(() => settingsCloseRef.current?.focus())
  }, [settingsOpen])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (settingsOpen) setSettingsOpen(false)
      else if (profileOpen) setProfileOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [profileOpen, settingsOpen])

  const healthy = snapshot.services.filter((service) => service.status === 'available').length
  const averageLatency = useMemo(() => getAverageLatency(snapshot.services), [snapshot.services])
  const updateReady = snapshot.latestVersion && snapshot.version !== snapshot.latestVersion

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

  async function update() {
    setAction('update'); setError(null)
    try {
      const value = await api.update()
      setSnapshot((current) => ({ ...value, services: current.services }))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось установить обновление') }
    finally { setAction(null) }
  }

  async function startTune() {
    setTuneOpen(true)
    setTune({ index: 0, total: snapshot.strategies.length || 8, strategy: 'Подготовка', phase: 'starting' })
    try {
      const result = await api.autoTune()
      setTune(result)
      if (result.phase === 'complete') setSnapshot(await api.snapshot())
    } catch (reason) {
      setTune((current) => ({ ...current, phase: 'error', message: reason instanceof Error ? reason.message : 'Ошибка проверки' }))
    }
  }

  async function cancelTune() {
    if (tune.phase === 'complete' || tune.phase === 'error' || tune.phase === 'cancelled') setTuneOpen(false)
    else await api.cancelTune()
  }

  async function changeSetting(key: keyof ManagerSettings, value: boolean) {
    if (key === 'autoUpdate') setAutoUpdate(value)
    if (key === 'startWithWindows') setStartWindows(value)
    if (key === 'backgroundCheck') setBackgroundCheck(value)
    try { await api.updateSettings({ [key]: value }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройку') }
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
          <button className="rail-button" aria-label="Диагностика" onClick={startTune}><Activity aria-hidden="true" /></button>
        </div>
        <div className="rail-bottom">
          <button className="rail-button" aria-label="Помощь" onClick={() => api.openExternal('https://github.com/Flowseal/zapret-discord-youtube/')}><CircleHelp aria-hidden="true" /></button>
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
              <button className={`power-button ${snapshot.running ? 'stop' : ''}`} onClick={toggle} disabled={action !== null}>
                {action === 'toggle' ? <LoaderCircle className="spin" aria-hidden="true" /> : snapshot.running ? <Square fill="currentColor" aria-hidden="true" /> : <Power aria-hidden="true" />}
                {snapshot.running ? 'Остановить' : 'Включить'}
              </button>
              <div className="profile-picker">
                <button className="secondary-button" onClick={() => setProfileOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={profileOpen}>
                  <span><span className="button-label">Конфиг</span>{snapshot.activeStrategy || 'Выбрать'}</span><ChevronDown aria-hidden="true" />
                </button>
                {profileOpen && (
                  <div className="profile-menu" role="listbox" aria-label="Выбор конфига">
                    {snapshot.strategies.map((profile) => (
                      <button key={profile} role="option" aria-selected={profile === snapshot.activeStrategy} onClick={() => selectProfile(profile)}>
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
          <div><h2>Сервисы</h2><p>Проверяем автоматически каждые 30 секунд</p></div>
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
            <button className="primary-button" onClick={startTune}><Search aria-hidden="true" /> Начать проверку</button>
          </article>
          <article className="update-card">
            <div className="update-top"><span className="card-overline">ОБНОВЛЕНИЯ</span>{updateReady ? <span className="version-badge">Доступно</span> : <span className="version-badge muted">Актуально</span>}</div>
            <h2>{updateReady ? `Версия ${snapshot.latestVersion}` : `Версия ${snapshot.version || 'не установлена'}`}</h2>
            <p>{updateReady ? 'Новые конфиги и улучшения Flowseal готовы к установке.' : 'Конфиги и ядро Flowseal обновлены.'}</p>
            <button className="text-button" onClick={update} disabled={action !== null}>{action === 'update' ? <LoaderCircle className="spin" /> : <ArrowDownToLine />} {snapshot.installed ? 'Проверить обновления' : 'Установить Zapret'}</button>
          </article>
        </section>

        <footer><span>Zapret Manager · {snapshot.version || 'не установлен'}</span><button onClick={() => api.openExternal('https://github.com/Flowseal/zapret-discord-youtube/')}><Github /> Официальный Flowseal <ExternalLink /></button></footer>
      </main>

      {settingsOpen && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="panel-heading"><div><span className="card-overline">ПРИЛОЖЕНИЕ</span><h2 id="settings-title">Настройки</h2></div><button ref={settingsCloseRef} className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки"><X /></button></div>
            <div className="settings-group">
              <Toggle label="Автообновление" description="Устанавливать свежие конфиги Flowseal" value={autoUpdate} onChange={(value) => changeSetting('autoUpdate', value)} />
              <Toggle label="Запуск вместе с Windows" description="Подключаться после входа в систему" value={startWindows} onChange={(value) => changeSetting('startWithWindows', value)} />
              <Toggle label="Фоновая диагностика" description="Проверять сервисы каждые 30 секунд" value={backgroundCheck} onChange={(value) => changeSetting('backgroundCheck', value)} />
            </div>
            <div className="source-card"><ShieldCheck /><div><strong>Безопасный источник</strong><span>Ядро загружается только из официального репозитория Flowseal и проверяется по SHA-256.</span></div></div>
            <button className="panel-link" onClick={() => api.openExternal('https://github.com/Flowseal/zapret-discord-youtube/')}><Github /> Открыть репозиторий <ExternalLink /></button>
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

function Toggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export default App
