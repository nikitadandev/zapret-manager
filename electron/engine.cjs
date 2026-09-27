const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const REPOSITORY = 'Flowseal/zapret-discord-youtube'
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const SERVICE_TARGETS = [
  { id: 'youtube', name: 'YouTube', host: 'youtube.com', url: 'https://www.youtube.com/generate_204' },
  { id: 'discord', name: 'Discord', host: 'discord.com', url: 'https://discord.com/api/v10/gateway' },
  { id: 'github', name: 'GitHub', host: 'github.com', url: 'https://github.com' },
  { id: 'telegram', name: 'Telegram', host: 'telegram.org', url: 'https://telegram.org' },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class ZapretEngine {
  constructor(userDataPath, sendProgress) {
    this.root = path.join(userDataPath, 'flowseal')
    this.stateFile = path.join(userDataPath, 'manager-state.json')
    this.sendProgress = sendProgress || (() => {})
    this.stateWrites = Promise.resolve()
    this.operation = null
    this.tuneCancelled = false
    this.demoRunning = true
    this.demoStrategy = 'General ALT 7'
  }

  get isWindows() { return process.platform === 'win32' }

  async exclusive(name, task) {
    if (this.operation) throw new Error(`Дождитесь завершения операции: ${this.operation}`)
    this.operation = name
    try { return await task() } finally { this.operation = null }
  }

  start(strategy) { return this.exclusive('запуск', () => this._start(strategy)) }
  stop() { return this.exclusive('остановка', () => this._stop()) }
  update() { return this.exclusive('обновление', () => this._update()) }
  autoTune() { return this.exclusive('подбор', () => this._autoTune()) }

  async readState() {
    try {
      const state = JSON.parse(await fs.readFile(this.stateFile, 'utf8'))
      return state && typeof state === 'object' && !Array.isArray(state) ? state : {}
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}
      throw error
    }
  }

  writeState(patch) {
    const pending = this.stateWrites.then(async () => {
      const current = await this.readState()
      const state = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true })
      const temp = `${this.stateFile}.tmp`
      await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
      await fs.rename(temp, this.stateFile)
      return state
    })
    this.stateWrites = pending.catch(() => {})
    return pending
  }

  async getSettings() {
    const state = await this.readState()
    return {
      autoUpdate: typeof state.settings?.autoUpdate === 'boolean' ? state.settings.autoUpdate : true,
      startWithWindows: typeof state.settings?.startWithWindows === 'boolean' ? state.settings.startWithWindows : true,
      backgroundCheck: typeof state.settings?.backgroundCheck === 'boolean' ? state.settings.backgroundCheck : true,
    }
  }

  async updateSettings(patch) {
    const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([key, value]) =>
      ['autoUpdate', 'startWithWindows', 'backgroundCheck'].includes(key) && typeof value === 'boolean'))
    await this.writeState((state) => ({ settings: { ...state.settings, ...allowed } }))
    return this.getSettings()
  }

  async getRelease() {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Zapret-Manager' },
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new Error(`GitHub вернул ${response.status}`)
    const release = await response.json()
    const asset = release.assets?.find((item) => typeof item.name === 'string' && item.name.toLowerCase().endsWith('.zip'))
    if (!asset) throw new Error('В официальном релизе нет ZIP-архива')
    if (typeof release.tag_name !== 'string' || !asset.browser_download_url?.startsWith(`https://github.com/${REPOSITORY}/releases/download/`)) throw new Error('Некорректные данные официального релиза')
    return { version: release.tag_name, asset }
  }

  async listStrategies() {
    if (!this.isWindows && !fsSync.existsSync(this.root)) {
      return ['General', ...Array.from({ length: 13 }, (_, index) => `General ALT ${index + 1}`)]
    }
    try {
      return (await fs.readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^general(?: \(ALT\d*\))?\.bat$/i.test(entry.name))
        .map((entry) => entry.name.replace(/\.bat$/i, '').replace(/[()]/g, '').replace(/ALT(\d+)/i, 'ALT $1'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    } catch { return [] }
  }

  strategyFile(strategy) {
    if (!strategy || strategy.toLowerCase() === 'general') return 'general.bat'
    const match = strategy.match(/ALT\s*(\d*)/i)
    return match ? `general (ALT${match[1]}).bat` : 'general.bat'
  }

  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, ...options })
      let stderr = ''
      child.stdout?.resume()
      child.stderr?.on('data', (data) => { stderr = (stderr + data.toString()).slice(-12000) })
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${command}: превышено время ожидания`)) }, 60000)
      child.once('close', () => clearTimeout(timer))
      child.once('error', () => clearTimeout(timer))
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command}: код ${code}`)))
    })
  }

  runStrategyScript(scriptPath) {
    return new Promise((resolve) => {
      const logPath = path.join(this.root, 'manager-launch.log')
      const command = `call "${path.basename(scriptPath)}" > "manager-launch.log" 2>&1`
      const child = spawn('cmd.exe', ['/d', '/q', '/c', command], {
        cwd: this.root,
        windowsHide: true,
        env: { ...process.env, NO_UPDATE_CHECK: '1' },
        stdio: 'ignore',
      })
      let settled = false
      const finish = async (result) => {
        if (settled) return
        settled = true
        let output = ''
        try { output = (await fs.readFile(logPath, 'utf8')).slice(-12000) } catch { /* The log is best-effort. */ }
        resolve({ ...result, output })
      }
      const timeout = setTimeout(() => {
        if (child.pid) this.run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {})
        finish({ code: null, timedOut: true })
      }, 15000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        finish({ code: -1, timedOut: false, spawnError: error.message })
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        finish({ code, timedOut: false })
      })
    })
  }

  async waitForRunning(expected, timeout = 8000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if ((await this.isRunning()) === expected) return true
      await sleep(250)
    }
    return false
  }

  async expandZip(archive, destination) {
    const quote = (value) => `'${value.replace(/'/g, "''")}'`
    const script = `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(destination)} -Force`
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    await this.run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
  }

  ownedProcessScript(stop = false) {
    const executable = path.join(this.root, 'bin', 'winws.exe').replace(/'/g, "''")
    const select = `$exe = '${executable}'; $owned = @(Get-CimInstance Win32_Process -Filter "Name = 'winws.exe'" -ErrorAction Stop | Where-Object { $_.ExecutablePath -ieq $exe });`
    if (!stop) return `${select} Write-Output $owned.Count`
    return `$ErrorActionPreference = 'Stop'; ${select}
      $service = Get-CimInstance Win32_Service -Filter "Name = 'zapret'";
      if ($service -and $service.PathName -and ($service.PathName -match ('^\"?' + [regex]::Escape($exe) + '(?:\"|\\s|$)'))) {
        Stop-Service -Name zapret -ErrorAction Stop
      }
      foreach ($ownedProcess in $owned) {
        $current = Get-Process -Id $ownedProcess.ProcessId -ErrorAction SilentlyContinue
        if ($current -and $current.Path -ieq $exe) { Stop-Process -Id $current.Id -Force -ErrorAction Stop }
      }`
  }

  async isRunning() {
    if (!this.isWindows) return this.demoRunning
    const { execFile } = require('node:child_process')
    const encoded = Buffer.from(this.ownedProcessScript(), 'utf16le').toString('base64')
    return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error) reject(new Error(`Не удалось проверить процесс Zapret: ${error.message}`))
        else resolve(Number(stdout.trim()) > 0)
      }))
  }

  async snapshot(includeRelease = true) {
    const state = await this.readState()
    let releaseError = null
    let latestVersion = state.latestVersion || null
    if (includeRelease) {
      try {
        latestVersion = (await this.getRelease()).version
        await this.writeState({ latestVersion })
      } catch (error) { releaseError = error.message }
    }
    const strategies = await this.listStrategies()
    const running = await this.isRunning()
    return {
      platform: process.platform,
      demoMode: !this.isWindows,
      installed: !this.isWindows || fsSync.existsSync(path.join(this.root, 'bin', 'winws.exe')),
      running,
      version: !this.isWindows ? '1.10.3' : state.version || null,
      latestVersion,
      releaseError,
      activeStrategy: !this.isWindows ? this.demoStrategy : running ? state.activeStrategy || null : null,
      enginePath: this.root,
      strategies,
      services: [],
      lastChecked: new Date().toISOString(),
    }
  }

  async probeOne(target) {
    const started = performance.now()
    try {
      const response = await fetch(target.url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Zapret-Manager/0.1' },
        signal: AbortSignal.timeout(6500),
      })
      const latency = Math.max(1, Math.round(performance.now() - started))
      await response.body?.cancel()
      const reachable = response.status >= 200 && response.status < 400
      return {
        id: target.id,
        name: target.name,
        host: target.host,
        latency,
        status: reachable ? (latency > 1200 ? 'slow' : 'available') : 'unavailable',
        detail: reachable ? undefined : `HTTP ${response.status}`,
      }
    } catch (error) {
      return { id: target.id, name: target.name, host: target.host, latency: null, status: 'unavailable', detail: error.name === 'TimeoutError' ? 'Тайм-аут' : 'Нет ответа' }
    }
  }

  async probeServices() {
    if (!this.isWindows) {
      await sleep(600)
      return SERVICE_TARGETS.map((target, index) => ({
        id: target.id, name: target.name, host: target.host,
        latency: [42, 58, 71, 49][index] + Math.round(Math.random() * 8), status: 'available',
      }))
    }
    return Promise.all(SERVICE_TARGETS.map((target) => this.probeOne(target)))
  }

  async _stop() {
    if (!this.isWindows) {
      await sleep(450)
      this.demoRunning = false
      return this.snapshot(false)
    }
    const encoded = Buffer.from(this.ownedProcessScript(true), 'utf16le').toString('base64')
    await this.run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
    if (!await this.waitForRunning(false, 4000)) throw new Error('Не удалось остановить winws.exe; проверьте права администратора')
    await this.writeState({ activeStrategy: null })
    await sleep(350)
    return this.snapshot(false)
  }

  async _start(strategy) {
    const strategies = await this.listStrategies()
    const selected = strategy || (await this.readState()).activeStrategy || strategies[0]
    if (!selected || !strategies.includes(selected)) throw new Error('Выбранный конфиг не найден')
    if (!this.isWindows) {
      await sleep(500)
      this.demoRunning = true
      this.demoStrategy = selected
      return this.snapshot(false)
    }
    const scriptPath = path.join(this.root, this.strategyFile(selected))
    if (!fsSync.existsSync(scriptPath)) throw new Error(`Файл конфига отсутствует: ${scriptPath}`)
    await this._stop()
    const result = await this.runStrategyScript(scriptPath)
    const running = await this.waitForRunning(true)
    if (!running) {
      const details = `${result.output}${result.spawnError ? `\n${result.spawnError}` : ''}`.replace(/\r/g, '').split('\n').filter(Boolean).slice(-6).join(' · ')
      throw new Error(`Конфиг ${selected} не запустил winws.exe${details ? `: ${details}` : result.timedOut ? ': BAT-файл не завершился за 15 секунд' : `: cmd завершился с кодом ${result.code}`}`)
    }
    await this.writeState({ activeStrategy: selected })
    return this.snapshot(false)
  }

  async readDownload(response) {
    const limit = 256 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel()
      throw new Error('Архив превышает допустимый размер 256 МБ')
    }
    if (!response.body) throw new Error('Пустой ответ при загрузке архива')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > limit) throw new Error('Архив превышает допустимый размер 256 МБ')
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  async preserveUserLists(destination) {
    let entries
    try { entries = await fs.readdir(path.join(this.root, 'lists'), { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    await fs.mkdir(path.join(destination, 'lists'), { recursive: true })
    for (const entry of entries) {
      if (entry.isFile() && /-user\.txt$/i.test(entry.name)) {
        await fs.copyFile(path.join(this.root, 'lists', entry.name), path.join(destination, 'lists', entry.name))
      }
    }
  }

  async _update() {
    if (!this.isWindows) {
      await sleep(1300)
      return this.snapshot(false)
    }
    const release = await this.getRelease()
    const previousState = await this.readState()
    const wasRunning = await this.isRunning()
    const previousStrategy = previousState.activeStrategy
    if (!/^sha256:[a-f0-9]{64}$/i.test(release.asset.digest || '')) throw new Error('У релиза нет SHA-256; установка отменена')
    const response = await fetch(release.asset.browser_download_url, {
      headers: { 'User-Agent': 'Zapret-Manager' }, signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) throw new Error(`Не удалось скачать релиз: ${response.status}`)
    const data = await this.readDownload(response)
    const digest = `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`
    if (digest !== release.asset.digest.toLowerCase()) throw new Error('Контрольная сумма релиза не совпала')

    const work = `${this.root}.update-${Date.now()}`
    const archive = `${work}.zip`
    await fs.mkdir(path.dirname(this.root), { recursive: true })
    await fs.writeFile(archive, data)
    try {
      await this.expandZip(archive, work)
      let source = work
      const entries = await fs.readdir(work, { withFileTypes: true })
      if (entries.length === 1 && entries[0].isDirectory()) source = path.join(work, entries[0].name)
      if (!fsSync.existsSync(path.join(source, 'bin', 'winws.exe'))) throw new Error('Архив не похож на официальный релиз Flowseal')
      await this.preserveUserLists(source)
      await this._stop()
      const backup = `${work}.backup`
      const hadPrevious = fsSync.existsSync(this.root)
      if (hadPrevious) {
        try { await fs.rename(this.root, backup) }
        catch (error) {
          if (wasRunning && previousStrategy) await this._start(previousStrategy)
          throw error
        }
      }
      try {
        await fs.rename(source, this.root)
        await this.writeState({ version: release.version, latestVersion: release.version, activeStrategy: null })
        const strategies = await this.listStrategies()
        if (!strategies.length) throw new Error('В архиве нет поддерживаемых конфигов')
        if (wasRunning) await this._start(strategies.includes(previousStrategy) ? previousStrategy : strategies[0])
      } catch (error) {
        try {
          await this._stop()
          await fs.rm(this.root, { recursive: true, force: true })
          if (hadPrevious) await fs.rename(backup, this.root)
          await this.writeState({ version: previousState.version || null, activeStrategy: previousStrategy || null })
          if (wasRunning && previousStrategy && hadPrevious) await this._start(previousStrategy)
        } catch (rollbackError) {
          throw new Error(`${error.message}. Не удалось восстановить сборку: ${rollbackError.message}. Резервная копия: ${backup}`)
        }
        throw error
      }
      await fs.rm(backup, { recursive: true, force: true })
      return this.snapshot(false)
    } finally {
      await fs.rm(work, { recursive: true, force: true })
      await fs.rm(archive, { force: true })
    }
  }

  async _autoTune() {
    this.tuneCancelled = false
    const previous = await this.snapshot(false)
    try {
      const result = await this.tuneStrategies()
      if (result.phase !== 'complete') await this.restoreAfterTune(previous)
      return result
    } catch (error) {
      await this.restoreAfterTune(previous)
      throw error
    }
  }

  async restoreAfterTune(previous) {
    if (previous.running && previous.activeStrategy) await this._start(previous.activeStrategy)
    else await this._stop()
  }

  async tuneStrategies() {
    const all = await this.listStrategies()
    const strategies = this.isWindows ? all : all.slice(0, 8)
    const results = []
    for (let index = 0; index < strategies.length; index += 1) {
      const strategy = strategies[index]
      if (this.tuneCancelled) {
        const progress = { index, total: strategies.length, strategy, phase: 'cancelled', results }
        this.sendProgress(progress)
        return progress
      }
      this.sendProgress({ index: index + 1, total: strategies.length, strategy, phase: 'starting' })
      try {
        await this._start(strategy)
      } catch (error) {
        results.push({ strategy, score: 0, reachable: 0, averageLatency: null, error: error.message })
        this.sendProgress({ index: index + 1, total: strategies.length, strategy, phase: 'testing', score: 0, message: error.message })
        continue
      }
      await sleep(this.isWindows ? 1800 : 350)
      this.sendProgress({ index: index + 1, total: strategies.length, strategy, phase: 'testing' })
      const probes = await this.probeServices()
      const successful = probes.filter((item) => (item.status === 'available' || item.status === 'slow') && Number.isFinite(item.latency))
      const averageLatency = successful.length ? Math.round(successful.reduce((sum, item) => sum + item.latency, 0) / successful.length) : null
      const reachability = (probes.length ? successful.length / probes.length : 0)
      const speed = averageLatency === null ? 0 : Math.max(0, 1 - averageLatency / 1800)
      const score = Math.round((reachability * 0.78 + speed * 0.22) * 100)
      results.push({ strategy, score, reachable: successful.length, averageLatency })
      this.sendProgress({ index: index + 1, total: strategies.length, strategy, phase: 'testing', score })
    }
    if (this.tuneCancelled) return { index: strategies.length, total: strategies.length, strategy: '', phase: 'cancelled', results }
    results.sort((a, b) => b.reachable - a.reachable || b.score - a.score || (a.averageLatency ?? Infinity) - (b.averageLatency ?? Infinity))
    const bestStrategy = results[0]?.score > 0 ? results[0].strategy : null
    if (!bestStrategy) return { index: strategies.length, total: strategies.length, strategy: '', phase: 'error', message: 'Рабочий конфиг не найден. Проверьте подключение и установку Zapret.', results }
    await this._start(bestStrategy)
    if (this.tuneCancelled) return { index: strategies.length, total: strategies.length, strategy: '', phase: 'cancelled', results }
    const progress = { index: strategies.length, total: strategies.length, strategy: bestStrategy, phase: 'complete', bestStrategy, results }
    this.sendProgress(progress)
    return progress
  }

  cancelTune() { this.tuneCancelled = true }
}

module.exports = { ZapretEngine, REPOSITORY }
