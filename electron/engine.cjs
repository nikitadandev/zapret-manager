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
    this.sendProgress = sendProgress
    this.tuneCancelled = false
    this.demoRunning = true
    this.demoStrategy = 'General ALT 7'
  }

  get isWindows() { return process.platform === 'win32' }

  async readState() {
    try { return JSON.parse(await fs.readFile(this.stateFile, 'utf8')) }
    catch { return {} }
  }

  async writeState(patch) {
    const state = { ...(await this.readState()), ...patch }
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true })
    await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2), 'utf8')
    return state
  }

  async getSettings() {
    const state = await this.readState()
    return {
      autoUpdate: state.settings?.autoUpdate ?? true,
      startWithWindows: state.settings?.startWithWindows ?? true,
      backgroundCheck: state.settings?.backgroundCheck ?? true,
    }
  }

  async updateSettings(patch) {
    const settings = { ...(await this.getSettings()), ...patch }
    await this.writeState({ settings })
    return settings
  }

  async getRelease() {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Zapret-Manager' },
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new Error(`GitHub вернул ${response.status}`)
    const release = await response.json()
    const asset = release.assets.find((item) => item.name.endsWith('.zip'))
    if (!asset) throw new Error('В официальном релизе нет ZIP-архива')
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
      child.stderr?.on('data', (data) => { stderr += data.toString() })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command}: код ${code}`)))
    })
  }

  async expandZip(archive, destination) {
    const quote = (value) => `'${value.replace(/'/g, "''")}'`
    const script = `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(destination)} -Force`
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    await this.run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
  }

  async isRunning() {
    if (!this.isWindows) return this.demoRunning
    try {
      await this.run('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/NH'])
      const { execFile } = require('node:child_process')
      return await new Promise((resolve) => execFile('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/NH'], (error, stdout) => resolve(!error && /winws\.exe/i.test(stdout))))
    } catch { return false }
  }

  async snapshot(includeRelease = true) {
    const state = await this.readState()
    let latestVersion = state.latestVersion || null
    if (includeRelease) {
      try {
        latestVersion = (await this.getRelease()).version
        await this.writeState({ latestVersion })
      } catch { /* Offline is a valid state. */ }
    }
    const strategies = await this.listStrategies()
    return {
      platform: process.platform,
      demoMode: !this.isWindows,
      installed: !this.isWindows || fsSync.existsSync(path.join(this.root, 'bin', 'winws.exe')),
      running: await this.isRunning(),
      version: !this.isWindows ? '1.10.3' : state.version || null,
      latestVersion,
      activeStrategy: !this.isWindows ? this.demoStrategy : state.activeStrategy || null,
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
      const reachable = response.status < 500
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

  async stop() {
    if (!this.isWindows) {
      await sleep(450)
      this.demoRunning = false
      return this.snapshot(false)
    }
    await Promise.allSettled([
      this.run('taskkill.exe', ['/F', '/IM', 'winws.exe']),
      this.run('sc.exe', ['stop', 'zapret']),
    ])
    await this.writeState({ activeStrategy: null })
    await sleep(350)
    return this.snapshot(false)
  }

  async start(strategy) {
    const strategies = await this.listStrategies()
    const selected = strategy || (await this.readState()).activeStrategy || strategies[0]
    if (!selected || !strategies.includes(selected)) throw new Error('Выбранный конфиг не найден')
    if (!this.isWindows) {
      await sleep(500)
      this.demoRunning = true
      this.demoStrategy = selected
      return this.snapshot(false)
    }
    if (!fsSync.existsSync(path.join(this.root, this.strategyFile(selected)))) throw new Error('Файл конфига отсутствует')
    await this.stop()
    const child = spawn('cmd.exe', ['/d', '/s', '/c', this.strategyFile(selected)], {
      cwd: this.root, windowsHide: true, detached: true, stdio: 'ignore',
    })
    child.unref()
    await this.writeState({ activeStrategy: selected })
    await sleep(900)
    return this.snapshot(false)
  }

  async update() {
    if (!this.isWindows) {
      await sleep(1300)
      return this.snapshot(false)
    }
    const release = await this.getRelease()
    const previousState = await this.readState()
    const wasRunning = await this.isRunning()
    const previousStrategy = previousState.activeStrategy
    const response = await fetch(release.asset.browser_download_url, {
      headers: { 'User-Agent': 'Zapret-Manager' }, signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) throw new Error(`Не удалось скачать релиз: ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    const digest = `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`
    if (release.asset.digest && digest !== release.asset.digest) throw new Error('Контрольная сумма релиза не совпала')

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
      await this.stop()
      const backup = `${this.root}.backup`
      await fs.rm(backup, { recursive: true, force: true })
      if (fsSync.existsSync(this.root)) await fs.rename(this.root, backup)
      try {
        await fs.rename(source, this.root)
      } catch (error) {
        if (fsSync.existsSync(backup)) await fs.rename(backup, this.root)
        throw error
      }
      await fs.rm(backup, { recursive: true, force: true })
      await this.writeState({ version: release.version, latestVersion: release.version, activeStrategy: null })
      const strategies = await this.listStrategies()
      if (wasRunning && previousStrategy && strategies.includes(previousStrategy)) return this.start(previousStrategy)
      return this.snapshot(false)
    } finally {
      await fs.rm(work, { recursive: true, force: true })
      await fs.rm(archive, { force: true })
    }
  }

  async autoTune() {
    this.tuneCancelled = false
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
      await this.start(strategy)
      await sleep(this.isWindows ? 1800 : 350)
      this.sendProgress({ index: index + 1, total: strategies.length, strategy, phase: 'testing' })
      const probes = await this.probeServices()
      const successful = probes.filter((item) => item.status !== 'unavailable')
      const averageLatency = successful.length ? Math.round(successful.reduce((sum, item) => sum + item.latency, 0) / successful.length) : null
      const reachability = successful.length / probes.length
      const speed = averageLatency === null ? 0 : Math.max(0, 1 - averageLatency / 1800)
      const score = Math.round((reachability * 0.78 + speed * 0.22) * 100)
      results.push({ strategy, score, reachable: successful.length, averageLatency })
      this.sendProgress({ index: index + 1, total: strategies.length, strategy, phase: 'testing', score })
    }
    results.sort((a, b) => b.score - a.score || (a.averageLatency ?? Infinity) - (b.averageLatency ?? Infinity))
    const bestStrategy = results[0]?.strategy
    if (bestStrategy) await this.start(bestStrategy)
    const progress = { index: strategies.length, total: strategies.length, strategy: bestStrategy, phase: 'complete', bestStrategy, results }
    this.sendProgress(progress)
    return progress
  }

  cancelTune() { this.tuneCancelled = true }
}

module.exports = { ZapretEngine, REPOSITORY }
