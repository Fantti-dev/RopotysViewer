import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { registerDataHandlers } from './ipc/dataHandlers'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    frame: false,           // custom titlebar
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Kehitysympäristössä Vite dev server, tuotannossa buildittu tiedosto
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../../index.html'))
  }
}

// ── IPC: Tiedoston valinta ──────────────────────────────────────────────────
ipcMain.handle('dialog:openDemo', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Avaa CS2 Demo',
    filters: [{ name: 'CS2 Demo', extensions: ['dem'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (canceled) return null
  return filePaths
})

// ── IPC: Python parser käynnistys ───────────────────────────────────────────
ipcMain.handle('parser:parse', async (_, demPath: string) => {
  return new Promise((resolve, reject) => {
    // Etsi Python: ensin venv, sitten system python
    const pythonPaths = [
      join(__dirname, '../../python/venv/Scripts/python.exe'), // Windows venv
      join(__dirname, '../../python/venv/bin/python'),          // Mac/Linux venv
      'python3',
      'python'
    ]
    const scriptPath = join(__dirname, '../../python/parser.py')

    const tryPython = (paths: string[]): void => {
      if (paths.length === 0) {
        reject(new Error('Python ei löydy. Asenna Python ja aja: cd python && pip install -r requirements.txt'))
        return
      }
      const pyExec = paths[0]
      const proc = spawn(pyExec, [scriptPath, demPath])

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
        // Lähetetään progress-päivitykset UI:lle
        mainWindow?.webContents.send('parser:progress', data.toString().trim())
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('error', () => tryPython(paths.slice(1)))

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout })
        } else {
          reject(new Error(`Parser epäonnistui:\n${stderr}`))
        }
      })
    }

    tryPython(pythonPaths)
  })
})

// ── IPC: Window kontrollit (custom titlebar) ────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ── Rekisteröi data-handlerst (SQL kyselyt) ─────────────────────────────────
registerDataHandlers()

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
