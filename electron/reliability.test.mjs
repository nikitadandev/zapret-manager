import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import engineModule from './engine.cjs'

const { ZapretEngine } = engineModule
let directory, engine
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zapret-test-'))
  engine = new ZapretEngine(directory)
  Object.defineProperty(engine, 'isWindows', { value: false, configurable: true })
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await fs.rm(directory, { recursive: true, force: true })
})
const windows = () => Object.defineProperty(engine, 'isWindows', { value: true, configurable: true })

describe('state and operation safety', () => {
  it('preserves concurrent settings and state writes', async () => {
    await Promise.all([
      engine.updateSettings({ autoUpdate: false }),
      engine.updateSettings({ backgroundCheck: false }),
      engine.writeState({ version: 'test' }),
    ])
    expect(await engine.getSettings()).toMatchObject({ autoUpdate: false, backgroundCheck: false })
    expect((await engine.readState()).version).toBe('test')
  })
  it('recovers from a null state and ignores invalid settings', async () => {
    await fs.writeFile(engine.stateFile, 'null')
    await engine.updateSettings({ autoUpdate: 'yes', startWithWindows: true, unknown: true })
    expect(await engine.getSettings()).toEqual({ autoUpdate: true, startWithWindows: true, backgroundCheck: true })
    expect((await engine.readState()).settings).not.toHaveProperty('unknown')
  })
  it('rejects overlapping mutations and releases the lock on failure', async () => {
    let finish
    const pending = engine.exclusive('test', () => new Promise((resolve) => { finish = resolve }))
    await expect(engine.stop()).rejects.toThrow('Дождитесь')
    finish()
    await pending
    await expect(engine.exclusive('test', () => { throw new Error('failed') })).rejects.toThrow('failed')
    expect(engine.operation).toBeNull()
  })
  it('does not clear the strategy when stopping fails', async () => {
    windows()
    await engine.writeState({ activeStrategy: 'General' })
    engine.run = vi.fn().mockResolvedValue(undefined)
    engine.waitForRunning = vi.fn().mockResolvedValue(false)
    await expect(engine.stop()).rejects.toThrow('Не удалось остановить')
    expect((await engine.readState()).activeStrategy).toBe('General')
  })
  it('exposes release lookup failures without losing local status', async () => {
    engine.getRelease = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await engine.snapshot()).toMatchObject({ releaseError: 'offline', running: true })
  })
})

describe('service probes', () => {
  it.each([403, 429, 500])('treats HTTP %s as unavailable and releases the body', async (status) => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, body: { cancel } }))
    expect((await engine.probeOne({ url: 'https://example.com' })).status).toBe('unavailable')
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('auto tune recovery', () => {
  it('reports error rather than success when no strategies exist', async () => {
    engine.listStrategies = vi.fn().mockResolvedValue([])
    engine._start = vi.fn()
    const result = await engine.autoTune()
    expect(result.phase).toBe('error')
    expect(engine._start).toHaveBeenCalledWith('General ALT 7')
  })
  it('honors cancellation during the last probe and restores the original strategy', async () => {
    engine.listStrategies = vi.fn().mockResolvedValue(['General'])
    engine._start = vi.fn()
    engine.probeServices = vi.fn().mockImplementation(async () => {
      engine.cancelTune()
      return [{ status: 'available', latency: 10 }]
    })
    const result = await engine.autoTune()
    expect(result.phase).toBe('cancelled')
    expect(engine._start.mock.calls).toEqual([['General'], ['General ALT 7']])
  })
  it('restores stopped state after all launches fail', async () => {
    engine.demoRunning = false
    engine.listStrategies = vi.fn().mockResolvedValue(['General'])
    engine._start = vi.fn().mockRejectedValue(new Error('failed'))
    engine._stop = vi.fn()
    expect((await engine.autoTune()).phase).toBe('error')
    expect(engine._stop).toHaveBeenCalledOnce()
  })
})

describe('update validation and rollback', () => {
  async function prepare(digest) {
    windows()
    engine.getRelease = vi.fn().mockResolvedValue({ version: 'new', asset: { browser_download_url: 'https://example.com', digest } })
    engine.isRunning = vi.fn().mockResolvedValue(true)
    engine._stop = vi.fn()
    await engine.writeState({ version: 'old', activeStrategy: 'General' })
    await fs.mkdir(path.join(engine.root, 'bin'), { recursive: true })
    await fs.writeFile(path.join(engine.root, 'bin', 'winws.exe'), 'old')
    await fs.writeFile(path.join(engine.root, 'general.bat'), 'old')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('archive')))
    engine.expandZip = vi.fn().mockImplementation(async (_archive, destination) => {
      await fs.mkdir(path.join(destination, 'bin'), { recursive: true })
      await fs.writeFile(path.join(destination, 'bin', 'winws.exe'), 'new')
      await fs.writeFile(path.join(destination, 'general.bat'), 'new')
    })
  }
  it.each([undefined, `sha256:${'0'.repeat(64)}`])('rejects absent or mismatched digest before stopping', async (digest) => {
    await prepare(digest)
    await expect(engine.update()).rejects.toThrow()
    expect(engine._stop).not.toHaveBeenCalled()
    expect(engine.expandZip).not.toHaveBeenCalled()
  })
  it('restores files, version and strategy when the new engine fails to start', async () => {
    await prepare(`sha256:${crypto.createHash('sha256').update('archive').digest('hex')}`)
    engine._start = vi.fn().mockRejectedValueOnce(new Error('new launch failed')).mockResolvedValueOnce(undefined)
    await expect(engine.update()).rejects.toThrow('new launch failed')
    expect(await fs.readFile(path.join(engine.root, 'bin', 'winws.exe'), 'utf8')).toBe('old')
    expect(await engine.readState()).toMatchObject({ version: 'old', activeStrategy: 'General' })
    expect(engine._start).toHaveBeenCalledTimes(2)
    expect((await fs.readdir(directory)).sort()).toEqual(['flowseal', 'manager-state.json'])
  })
})

describe('download and user data', () => {
  it('preserves custom lists without copying binaries or vendor lists', async () => {
    const lists = path.join(engine.root, 'lists')
    const destination = path.join(directory, 'staging')
    await fs.mkdir(lists, { recursive: true })
    await fs.writeFile(path.join(lists, 'list-general-user.txt'), 'my.example')
    await fs.writeFile(path.join(lists, 'list-general.txt'), 'vendor.example')
    await engine.preserveUserLists(destination)
    expect(await fs.readdir(path.join(destination, 'lists'))).toEqual(['list-general-user.txt'])
    expect(await fs.readFile(path.join(destination, 'lists', 'list-general-user.txt'), 'utf8')).toBe('my.example')
  })
  it('rejects an oversized download before reading it', async () => {
    const response = new Response('small', { headers: { 'content-length': String(257 * 1024 * 1024) } })
    await expect(engine.readDownload(response)).rejects.toThrow('256 МБ')
    expect(response.bodyUsed).toBe(true)
  })
  it('reads chunked responses without a content length', async () => {
    expect(await engine.readDownload(new Response('archive'))).toEqual(Buffer.from('archive'))
  })
})
