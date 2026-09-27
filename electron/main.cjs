const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const { ZapretEngine } = require('./engine.cjs')

let mainWindow
let engine
let managerUpdateInfo = null
let managerUpdateDownloaded = false
let updaterBusy = false
const appUrl = app.isPackaged ? pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href : 'http://127.0.0.1:5173/'

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value)
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== appUrl) {
      throw new Error('Недопустимый источник IPC')
    }
    return callback(event, ...args)
  })
}

async function withUpdater(task) {
  if (updaterBusy || engine.operation) throw new Error('Дождитесь завершения текущей операции')
  updaterBusy = true
  try { return await task() } finally { updaterBusy = false }
}

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.on('error', (error) => send('manager:background-error', error.message))

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#0d1017',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d1017', symbolColor: '#8f97a8', height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.on('close', (event) => {
    if (engine?.operation) {
      event.preventDefault()
      engine.cancelTune()
      send('manager:background-error', 'Дождитесь завершения операции перед закрытием окна')
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)

  if (!app.isPackaged) mainWindow.loadURL('http://127.0.0.1:5173')
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  engine = new ZapretEngine(app.getPath('userData'), (progress) => send('manager:tune-progress', progress))
  handle('manager:snapshot', () => engine.snapshot())
  handle('manager:status', () => engine.snapshot(false))
  handle('manager:probe', () => engine.probeServices())
  handle('manager:start', (_event, strategy) => engine.start(strategy))
  handle('manager:stop', () => engine.stop())
  handle('manager:update', () => engine.update())
  handle('manager:auto-tune', () => engine.autoTune())
  handle('manager:cancel-tune', () => { engine.cancelTune(); return true })
  handle('manager:get-settings', () => engine.getSettings())
  handle('manager:update-settings', async (_event, patch) => {
    const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([key, value]) => ['autoUpdate', 'startWithWindows', 'backgroundCheck'].includes(key) && typeof value === 'boolean'))
    const settings = await engine.updateSettings(allowed)
    if (process.platform === 'win32' && 'startWithWindows' in allowed) {
      app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: process.execPath })
    }
    return settings
  })
  handle('manager:check-app-update', () => withUpdater(async () => {
    if (!app.isPackaged || process.platform !== 'win32') {
      return { currentVersion: app.getVersion(), latestVersion: app.getVersion(), available: false, developmentMode: true }
    }
    const result = await autoUpdater.checkForUpdates()
    managerUpdateInfo = result?.isUpdateAvailable ? result.updateInfo : null
    managerUpdateDownloaded = false
    const latestVersion = managerUpdateInfo?.version || app.getVersion()
    return { currentVersion: app.getVersion(), latestVersion, available: Boolean(managerUpdateInfo) }
  }))
  handle('manager:download-app-update', () => withUpdater(async () => {
    if (!managerUpdateInfo) throw new Error('Сначала проверьте наличие обновления менеджера')
    await autoUpdater.downloadUpdate()
    managerUpdateDownloaded = true
    return { currentVersion: app.getVersion(), latestVersion: managerUpdateInfo.version, available: true, downloaded: true }
  }))
  handle('manager:install-app-update', () => {
    if (!app.isPackaged || process.platform !== 'win32') return false
    if (!managerUpdateDownloaded || updaterBusy || engine.operation) throw new Error('Обновление не готово или выполняется другая операция')
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  })
  handle('manager:open-engine-folder', async () => {
    await require('node:fs/promises').mkdir(engine.root, { recursive: true })
    const error = await shell.openPath(engine.root)
    if (error) throw new Error(error)
    return engine.root
  })
  handle('manager:open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^https:\/\/(github\.com|zapret\.info)\//.test(url)) throw new Error('Недопустимая ссылка')
    return shell.openExternal(url)
  })
  createWindow()
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const settings = await engine.getSettings()
      if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: process.execPath })
      if (!settings.autoUpdate || process.platform !== 'win32') return
      const current = await engine.snapshot()
      if (!current.installed || (current.latestVersion && current.version !== current.latestVersion)) {
        const updated = await engine.update()
        send('manager:state-changed', updated)
      }
    } catch (error) {
      send('manager:background-error', error.message)
    }
  })
}).catch((error) => { console.error(error); app.quit() })

app.on('before-quit', (event) => {
  if (engine?.operation) {
    event.preventDefault()
    engine.cancelTune()
    send('manager:background-error', 'Дождитесь завершения операции перед выходом')
  }
})
app.on('window-all-closed', () => app.quit())
