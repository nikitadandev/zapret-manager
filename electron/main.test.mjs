import { beforeEach, describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let handlers, window, updater, engine, event
beforeEach(async () => {
  handlers = new Map()
  updater = { on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
  class FakeEngine {
    constructor() { engine = this; this.operation = null; this.root = '/tmp/flowseal' }
    snapshot() { return 'snapshot' }
  }
  class FakeWindow {
    constructor() {
      window = this
      this.webContents = {
        mainFrame: { url: 'file:///app/dist/index.html' },
        on: vi.fn(), once: vi.fn(), send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      }
    }
    isDestroyed() { return false }
    on() {}
    once() {}
    loadFile() {}
  }
  const electron = {
    app: { isPackaged: true, getVersion: () => '1.0.0', requestSingleInstanceLock: () => true,
      on: vi.fn(), whenReady: () => Promise.resolve(), getPath: () => '/tmp', quit: vi.fn() },
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    shell: { openExternal: vi.fn() },
  }
  vm.runInNewContext(fs.readFileSync(new URL('./main.cjs', import.meta.url), 'utf8'), {
    require: (name) => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: updater } : name === './engine.cjs' ? { ZapretEngine: FakeEngine } : name === 'node:path' ? path.posix : require(name),
    __dirname: '/app/electron', process: { platform: 'win32', execPath: '/app/manager.exe' },
    console, setImmediate,
  })
  await Promise.resolve()
  event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
})

describe('privileged IPC and updater', () => {
  it('accepts the application main frame', () => {
    expect(handlers.get('manager:snapshot')(event)).toBe('snapshot')
  })
  it('rejects foreign frames and navigated pages', () => {
    expect(() => handlers.get('manager:snapshot')({ ...event, senderFrame: { url: event.senderFrame.url } })).toThrow('IPC')
    event.senderFrame.url = 'https://example.com'
    expect(() => handlers.get('manager:snapshot')(event)).toThrow('IPC')
  })
  it('does not advertise an older release as an update', async () => {
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '0.9.0' } })
    expect(await handlers.get('manager:check-app-update')(event)).toMatchObject({ available: false })
    await expect(handlers.get('manager:download-app-update')(event)).rejects.toThrow('Сначала')
  })
  it('rejects installation before the download completes', () => {
    expect(() => handlers.get('manager:install-app-update')(event)).toThrow('не готово')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('blocks updater operations while tuning', async () => {
    engine.operation = 'подбор'
    await expect(handlers.get('manager:check-app-update')(event)).rejects.toThrow('Дождитесь')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})
