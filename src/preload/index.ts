import { contextBridge, ipcRenderer } from 'electron'

// Kaikki IPC-kutsut jotka renderer-prosessi saa käyttää
// contextBridge estää suoran Node.js-pääsyn (turvallisuus)
contextBridge.exposeInMainWorld('electronAPI', {

  // ── Tiedostot ──────────────────────────────────────────────────────────────
  openDemoDialog: () =>
    ipcRenderer.invoke('dialog:openDemo'),

  parseDemo: (demPath: string) =>
    ipcRenderer.invoke('parser:parse', demPath),

  onParserProgress: (callback: (msg: string) => void) => {
    ipcRenderer.on('parser:progress', (_, msg) => callback(msg))
    return () => ipcRenderer.removeAllListeners('parser:progress')
  },

  // ── Demo lista & metadata ──────────────────────────────────────────────────
  getDemos: () =>
    ipcRenderer.invoke('data:getDemos'),

  getDemoById: (demoId: number) =>
    ipcRenderer.invoke('data:getDemoById', demoId),

  deleteDemo: (demoId: number) =>
    ipcRenderer.invoke('data:deleteDemo', demoId),

  // ── Roundit ────────────────────────────────────────────────────────────────
  getRounds: (demoId: number) =>
    ipcRenderer.invoke('data:getRounds', demoId),

  // ── Pelaajat ───────────────────────────────────────────────────────────────
  getPlayers: (demoId: number) =>
    ipcRenderer.invoke('data:getPlayers', demoId),

  // ── Sijainnit (replay) ─────────────────────────────────────────────────────
  // Palauttaa kaikki tickit yhdelle roundille (iso data)
  getPositions: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getPositions', demoId, roundNum),

  // ── Tapot ──────────────────────────────────────────────────────────────────
  getKills: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getKills', demoId, roundNum),

  // ── Damage ─────────────────────────────────────────────────────────────────
  getDamage: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getDamage', demoId, roundNum),

  // ── Granaatit ──────────────────────────────────────────────────────────────
  getGrenades: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getGrenades', demoId, roundNum),

  getGrenadeTrajectories: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getGrenadeTrajectories', demoId, roundNum),
  getInfernoFires: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getInfernoFires', demoId, roundNum),

  getSmokeEffects: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getSmokeEffects', demoId, roundNum),

  // ── Pommi ──────────────────────────────────────────────────────────────────
  getBombEvents: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getBombEvents', demoId, roundNum),

  // ── Laukaukset ─────────────────────────────────────────────────────────────
  getShotsFired: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getShotsFired', demoId, roundNum),

  // ── Kaikki round-data yhdellä kutsulla (cache) ─────────────────────────────
  loadRoundAll: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:loadRoundAll', demoId, roundNum),

  getCumulativeStats: (demoId: number, upToRound: number) =>
    ipcRenderer.invoke('data:getCumulativeStats', demoId, upToRound),

  // ── Lataa kaikki kierrokset taustalla ──────────────────────────────────────
  preloadAllRounds: (demoId: number, roundNums: number[]) =>
    ipcRenderer.invoke('data:preloadAllRounds', demoId, roundNums),

  onPreloadProgress: (cb: (data: { done: number; total: number; roundNum: number | null; complete?: boolean }) => void) => {
    ipcRenderer.on('preload:progress', (_event, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('preload:progress')
  },

  // ── Heatmap (kaikki roundit) ───────────────────────────────────────────────
  getHeatmapPositions: (demoId: number, steamId?: string) =>
    ipcRenderer.invoke('data:getHeatmapPositions', demoId, steamId),

  // ── Flash events ───────────────────────────────────────────────────────────
  getFlashEvents: (demoId: number, roundNum: number) =>
    ipcRenderer.invoke('data:getFlashEvents', demoId, roundNum),

  // ── Window kontrollit ──────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),
  getMapsPath:    () => ipcRenderer.invoke('app:getMapsPath'),
})

// TypeScript-tyypit renderer-puolelle
export type ElectronAPI = typeof window.electronAPI