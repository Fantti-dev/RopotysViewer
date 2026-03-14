import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { registerDataHandlers } from './dataHandlers'
import { readFileSync } from 'fs'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    frame: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        mainWindow?.webContents.openDevTools()
      }
    })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('dialog:openDemo', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Avaa CS2 Demo',
    filters: [{ name: 'CS2 Demo', extensions: ['dem'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (canceled) return null
  return filePaths
})

ipcMain.handle('parser:parse', async (_, demPath: string) => {
  return new Promise((resolve, reject) => {
    const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined
    const appRoot = isDev
      ? join(__dirname, '../..')   // out/main/ → out/ → D:\2Dviewer\
      : join(app.getAppPath(), '../..')
    const scriptPath = join(appRoot, 'python/parser.py')
    const pythonPaths = [
      join(appRoot, 'python/venv/Scripts/python.exe'),
      join(appRoot, 'python/venv/bin/python'),
      'python3',
      'python'
    ]

    console.log('[Parser] __dirname:', __dirname)
    console.log('[Parser] appRoot:', appRoot)
    console.log('[Parser] scriptPath:', scriptPath)
    mainWindow?.webContents.send('parser:progress', `[DEBUG] appRoot: ${appRoot}`)
    mainWindow?.webContents.send('parser:progress', `[DEBUG] script: ${scriptPath}`)
    mainWindow?.webContents.send('parser:progress', `[DEBUG] dem: ${demPath}`)

    const tryPython = (paths: string[]): void => {
      if (paths.length === 0) {
        reject(new Error('Python ei löydy. Asenna Python ja aja: cd python && pip install -r requirements.txt'))
        return
      }
      const proc = spawn(paths[0], [scriptPath, demPath], {
        windowsVerbatimArguments: false
      })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (data) => {
        stdout += data.toString()
        mainWindow?.webContents.send('parser:progress', data.toString().trim())
      })
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
        mainWindow?.webContents.send('parser:progress', `[VIRHE] ${data.toString().trim()}`)
      })
      proc.on('error', () => tryPython(paths.slice(1)))
      proc.on('close', (code) => {
        if (code === 0) resolve({ success: true, output: stdout })
        else reject(new Error(`Parser epäonnistui:\n${stderr}`))
      })
    }
    tryPython(pythonPaths)
  })
})

ipcMain.handle('app:getMapsPath', () => {
  const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined
  return isDev
    ? join(__dirname, '../../maps')
    : join(app.getAppPath(), '../../maps')
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

registerDataHandlers()

// Rekisteröi maps:// protokolla ENNEN app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'maps', privileges: { secure: true, standard: true, supportFetchAPI: true } }
])

app.whenReady().then(() => {
  // Servaa maps://filename.png → D:\2Dviewer\maps\filename.png
  const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined
  const mapsDir = isDev
    ? join(__dirname, '../../maps')
    : join(app.getAppPath(), '../../maps')

  protocol.handle('maps', (request) => {
    const filename = request.url.replace('maps://', '')
    const filePath = join(mapsDir, filename)
    try {
      const data = readFileSync(filePath)
      return new Response(data, {
        headers: { 'Content-Type': 'image/png' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
