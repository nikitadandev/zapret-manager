const path = require('node:path')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const { ZapretEngine } = require('./engine.cjs')

let mainWindow
let engine
let managerUpdateInfo = null

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

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
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged) mainWindow.loadURL('http://127.0.0.1:5173')
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  engine = new ZapretEngine(app.getPath('userData'), (progress) => mainWindow?.webContents.send('manager:tune-progress', progress))
  ipcMain.handle('manager:snapshot', () => engine.snapshot())
  ipcMain.handle('manager:probe', () => engine.probeServices())
  ipcMain.handle('manager:start', (_event, strategy) => engine.start(strategy))
  ipcMain.handle('manager:stop', () => engine.stop())
  ipcMain.handle('manager:update', () => engine.update())
  ipcMain.handle('manager:auto-tune', () => engine.autoTune())
  ipcMain.handle('manager:cancel-tune', () => { engine.cancelTune(); return true })
  ipcMain.handle('manager:get-settings', () => engine.getSettings())
  ipcMain.handle('manager:update-settings', async (_event, patch) => {
    const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([key, value]) => ['autoUpdate', 'startWithWindows', 'backgroundCheck'].includes(key) && typeof value === 'boolean'))
    const settings = await engine.updateSettings(allowed)
    if (process.platform === 'win32' && 'startWithWindows' in allowed) {
      app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: process.execPath })
    }
    return settings
  })
  ipcMain.handle('manager:check-app-update', async () => {
    if (!app.isPackaged) {
      return { currentVersion: app.getVersion(), latestVersion: app.getVersion(), available: false, developmentMode: true }
    }
    const result = await autoUpdater.checkForUpdates()
    managerUpdateInfo = result?.updateInfo || null
    const latestVersion = managerUpdateInfo?.version || app.getVersion()
    return { currentVersion: app.getVersion(), latestVersion, available: latestVersion !== app.getVersion() }
  })
  ipcMain.handle('manager:download-app-update', async () => {
    if (!managerUpdateInfo) throw new Error('Сначала проверьте наличие обновления менеджера')
    await autoUpdater.downloadUpdate()
    return { currentVersion: app.getVersion(), latestVersion: managerUpdateInfo.version, available: true, downloaded: true }
  })
  ipcMain.handle('manager:install-app-update', () => {
    if (!app.isPackaged) return false
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  })
  ipcMain.handle('manager:open-external', (_event, url) => {
    if (!/^https:\/\/(github\.com|zapret\.info)\//.test(url)) throw new Error('Недопустимая ссылка')
    return shell.openExternal(url)
  })
  createWindow()
  mainWindow.webContents.once('did-finish-load', async () => {
    const settings = await engine.getSettings()
    if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: process.execPath })
    if (!settings.autoUpdate || process.platform !== 'win32') return
    try {
      const current = await engine.snapshot()
      if (!current.installed || (current.latestVersion && current.version !== current.latestVersion)) {
        const updated = await engine.update()
        mainWindow?.webContents.send('manager:state-changed', updated)
      }
    } catch (error) {
      mainWindow?.webContents.send('manager:background-error', error.message)
    }
  })
})

app.on('window-all-closed', () => app.quit())
