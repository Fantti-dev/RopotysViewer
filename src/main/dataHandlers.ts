import { ipcMain, app } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { mkdirSync, appendFileSync } from 'fs'
import sql from 'mssql'

// ── SQL Server konfiguraatio ──────────────────────────────────────────────────
// Muuta nämä omiin asetuksiisi!
const DB_CONFIG: sql.config = {
  server: 'localhost',
  port: 1433,
  database: 'cs2demos',
  authentication: {
    type: 'default',
    options: {
      userName: 'cs2user',
      password: 'cs2pass123!',
    }
  },
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
}


let pool: sql.ConnectionPool | null = null
let poolPromise: Promise<sql.ConnectionPool> | null = null
let debugLogPath: string | null = null

function getDebugLogPath() {
  if (debugLogPath) return debugLogPath
  const debugLogDir = join(app.getPath('userData'), 'logs')
  debugLogPath = join(debugLogDir, `debug-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
  mkdirSync(debugLogDir, { recursive: true })
  return debugLogPath
}

function writeDebugLog(event: string, payload: unknown) {
  try {
    const path = getDebugLogPath()
    const row = JSON.stringify({ ts: new Date().toISOString(), event, payload })
    appendFileSync(path, `${row}\n`, 'utf-8')
  } catch {
    // Logging must never crash app behavior.
  }
}

interface RoundLoadOptions {
  includeKills?: boolean
  includeSmokes?: boolean
  includeBomb?: boolean
  includeShots?: boolean
  includeGrenades?: boolean
  includeTrajectories?: boolean
}

interface RoundCache {
  positions: any[]
  kills: any[]
  grenades: any[]
  trajectories: any[]
  smokes: any[]
  bomb: any[]
  flash: any[]
  infernoFires: any[]
  shots: any[]
  damage: any[]
}

function buildDamageDoneSummary(damageRows: any[]) {
  const byPlayerVictim = new Map<string, { steamId: string; victimId: string; totalDamage: number; utilDamage: number; hits: number }>()

  for (const row of damageRows) {
    const steamId = String(row.attacker_steam_id ?? '')
    const victimId = String(row.victim_steam_id ?? '')
    if (!steamId) continue

    const attackerTeam = String(row.attacker_team ?? '')
    const victimTeam = String(row.victim_team ?? '')
    if (attackerTeam && victimTeam && attackerTeam === victimTeam) continue

    const damage = Number(row.damage ?? 0)
    const weapon = String(row.weapon ?? '')
    const isUtility = ['hegrenade', 'molotov', 'incgrenade', 'inferno'].some((kind) => weapon.includes(kind))
    const key = `${steamId}:${victimId}`
    const prev = byPlayerVictim.get(key) ?? { steamId, victimId, totalDamage: 0, utilDamage: 0, hits: 0 }
    prev.totalDamage += damage
    prev.hits += 1
    if (isUtility) prev.utilDamage += damage
    byPlayerVictim.set(key, prev)
  }

  const byPlayer = new Map<string, { steamId: string; totalDamage: number; utilDamage: number; hits: number }>()
  for (const row of byPlayerVictim.values()) {
    const cappedTotal = Math.min(100, row.totalDamage)
    const cappedUtil = Math.min(cappedTotal, row.utilDamage)
    const prev = byPlayer.get(row.steamId) ?? { steamId: row.steamId, totalDamage: 0, utilDamage: 0, hits: 0 }
    prev.totalDamage += cappedTotal
    prev.utilDamage += cappedUtil
    prev.hits += row.hits
    byPlayer.set(row.steamId, prev)
  }

  return Array.from(byPlayer.values()).sort((a, b) => b.totalDamage - a.totalDamage)
}

const roundDataCache = new Map<string, RoundCache>()
const roundDataInFlight = new Map<string, Promise<RoundCache>>()
const MAX_ROUND_CACHE_ENTRIES = 48

function getRoundCacheKey(demoId: number, roundNum: number, options: RoundLoadOptions = {}) {
  return [
    demoId,
    roundNum,
    options.includeKills !== false ? 1 : 0,
    options.includeSmokes !== false ? 1 : 0,
    options.includeBomb !== false ? 1 : 0,
    options.includeShots !== false ? 1 : 0,
    options.includeGrenades !== false ? 1 : 0,
    options.includeTrajectories !== false ? 1 : 0,
  ].join(':')
}

function setRoundCacheValue(key: string, value: RoundCache) {
  if (roundDataCache.has(key)) roundDataCache.delete(key)
  roundDataCache.set(key, value)
  while (roundDataCache.size > MAX_ROUND_CACHE_ENTRIES) {
    const oldestKey = roundDataCache.keys().next().value
    if (!oldestKey) break
    roundDataCache.delete(oldestKey)
  }
}

interface RoundDamageWindowDiagnostics {
  roundStartTick: number
  roundEndTick: number
  totalRows: number
  inWindowRows: number
  beforeRoundRows: number
  afterRoundRows: number
}

async function fetchRoundDamageWindowDiagnostics(
  p: sql.ConnectionPool,
  demoId: number,
  roundNum: number,
): Promise<RoundDamageWindowDiagnostics | null> {
  const boundsAndCounts = await p.request()
    .input('demoId', sql.Int, demoId)
    .input('roundNum', sql.Int, roundNum)
    .query(`
      SELECT
        r.start_tick AS round_start_tick,
        ISNULL(rn.start_tick, 2147483647) AS round_end_tick,
        COUNT(d.id) AS total_damage_rows,
        SUM(CASE WHEN d.tick >= r.start_tick AND d.tick < ISNULL(rn.start_tick, 2147483647) THEN 1 ELSE 0 END) AS in_window_rows,
        SUM(CASE WHEN d.tick < r.start_tick THEN 1 ELSE 0 END) AS before_round_rows,
        SUM(CASE WHEN d.tick >= ISNULL(rn.start_tick, 2147483647) THEN 1 ELSE 0 END) AS after_round_rows
      FROM rounds r
      LEFT JOIN rounds rn ON rn.demo_id=r.demo_id AND rn.round_num=r.round_num+1
      LEFT JOIN damage d ON d.demo_id=r.demo_id AND d.round_num=r.round_num
      WHERE r.demo_id=@demoId AND r.round_num=@roundNum
      GROUP BY r.start_tick, rn.start_tick
    `)
  const row = boundsAndCounts.recordset[0]
  if (!row) return null

  return {
    roundStartTick: Number(row.round_start_tick ?? 0),
    roundEndTick: Number(row.round_end_tick ?? 0),
    totalRows: Number(row.total_damage_rows ?? 0),
    inWindowRows: Number(row.in_window_rows ?? 0),
    beforeRoundRows: Number(row.before_round_rows ?? 0),
    afterRoundRows: Number(row.after_round_rows ?? 0),
  }
}

// ── Kierrosdatan lataus (ilman main-prosessin välimuistia) ───────────────────
// Standalone funktio — käytettävissä sekä IPC-handlereissa että preloadissa
async function loadRoundData(demoId: number, roundNum: number, options: RoundLoadOptions = {}): Promise<RoundCache> {
  const cacheKey = getRoundCacheKey(demoId, roundNum, options)
  const cached = roundDataCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const inFlight = roundDataInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  const loadPromise = loadRoundDataUncached(demoId, roundNum, options)
  roundDataInFlight.set(cacheKey, loadPromise)
  try {
    const loaded = await loadPromise
    setRoundCacheValue(cacheKey, loaded)
    return loaded
  } finally {
    if (roundDataInFlight.get(cacheKey) === loadPromise) {
      roundDataInFlight.delete(cacheKey)
    }
  }
}

async function loadRoundDataUncached(demoId: number, roundNum: number, options: RoundLoadOptions = {}): Promise<RoundCache> {
  const startedAt = Date.now()
  writeDebugLog('round.load.main.start', { demoId, roundNum, options })
  const isDev     = process.env['ELECTRON_RENDERER_URL'] !== undefined
  const appRoot   = isDev ? join(__dirname, '../..') : join(app.getAppPath(), '../..')
  const pythonExe = join(appRoot, 'python', 'venv', 'Scripts', 'python.exe')
  const fs        = require('fs')

  const runPy = (script: string, parquet: string, ...args: string[]): Promise<any[]> =>
    new Promise(resolve => {
      if (!fs.existsSync(parquet)) { resolve([]); return }
      const proc = spawn(pythonExe, [script, parquet, ...args], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })
      let stdout = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => {})
      proc.on('close', () => {
        try { resolve(stdout.trim() ? JSON.parse(stdout.trim()) : []) }
        catch { resolve([]) }
      })
      proc.on('error', () => resolve([]))
    })

  const p = await getPool()
  const sqlRound = async (query: string) => {
    const r = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(query)
    return r.recordset
  }

  const includeKills = options.includeKills !== false
  const includeSmokes = options.includeSmokes !== false
  const includeBomb = options.includeBomb !== false
  const includeShots = options.includeShots !== false
  const includeGrenades = options.includeGrenades !== false
  const includeTrajectories = options.includeTrajectories !== false

  let damageWindowDiagnostics: RoundDamageWindowDiagnostics | null | undefined
  if (includeKills) {
    try {
      damageWindowDiagnostics = await fetchRoundDamageWindowDiagnostics(p, demoId, roundNum)
    } catch (error) {
      writeDebugLog('round.damage.window_diagnostics.error', {
        demoId,
        roundNum,
        error: error instanceof Error ? error.message : String(error),
      })
      // keep load resilient even if diagnostics query fails
    }
  } else {
    writeDebugLog('round.damage.window_diagnostics.skipped', {
      demoId,
      roundNum,
      reason: 'includeKills=false',
      options,
    })
  }

  const [positions, kills, grenades, smokes, bomb, flash, shots, trajectories, infernoFires, damage] =
    await Promise.all([
      runPy(join(appRoot,'python','read_positions.py'),    join(appRoot,'demos',`${demoId}_positions.parquet`),     String(roundNum)),
      includeKills ? sqlRound(`SELECT k.*, pa.name AS attacker_name, pv.name AS victim_name, pas.name AS assister_name FROM kills k LEFT JOIN players pa ON pa.steam_id=k.attacker_steam_id AND pa.demo_id=k.demo_id LEFT JOIN players pv ON pv.steam_id=k.victim_steam_id AND pv.demo_id=k.demo_id LEFT JOIN players pas ON pas.steam_id=k.assister_steam_id AND pas.demo_id=k.demo_id WHERE k.demo_id=@demoId AND k.round_num=@roundNum ORDER BY k.tick`) : Promise.resolve([]),
      includeGrenades ? sqlRound(`SELECT g.*, p.name AS thrower_name FROM grenades g LEFT JOIN players p ON p.steam_id=g.thrower_steam_id AND p.demo_id=g.demo_id WHERE g.demo_id=@demoId AND g.round_num=@roundNum ORDER BY g.tick_thrown`) : Promise.resolve([]),
      includeSmokes ? sqlRound(`SELECT se.* FROM smoke_effects se INNER JOIN grenades g ON g.id=se.grenade_id WHERE g.demo_id=@demoId AND g.round_num=@roundNum ORDER BY se.start_tick`) : Promise.resolve([]),
      includeBomb ? sqlRound(`SELECT be.*, p.name AS player_name FROM bomb_events be LEFT JOIN players p ON p.steam_id=be.player_steam_id AND p.demo_id=be.demo_id WHERE be.demo_id=@demoId AND be.round_num=@roundNum ORDER BY be.tick`) : Promise.resolve([]),
      includeKills ? sqlRound(`SELECT fe.*, pt.name AS thrower_name, pb.name AS blinded_name FROM flash_events fe LEFT JOIN players pt ON pt.steam_id=fe.thrower_steam_id AND pt.demo_id=fe.demo_id LEFT JOIN players pb ON pb.steam_id=fe.blinded_steam_id AND pb.demo_id=fe.demo_id WHERE fe.demo_id=@demoId AND fe.round_num=@roundNum ORDER BY fe.tick`) : Promise.resolve([]),
      includeShots ? sqlRound(`SELECT sf.*, p.name AS player_name FROM shots_fired sf LEFT JOIN players p ON p.steam_id=sf.steam_id AND p.demo_id=sf.demo_id WHERE sf.demo_id=@demoId AND sf.round_num=@roundNum ORDER BY sf.tick`) : Promise.resolve([]),
      includeTrajectories ? runPy(join(appRoot,'python','read_trajectories.py'), join(appRoot,'demos',`${demoId}_trajectories.parquet`),  String(demoId), String(roundNum)) : Promise.resolve([]),
      includeSmokes ? runPy(join(appRoot,'python','read_inferno_fires.py'),join(appRoot,'demos',`${demoId}_inferno_fires.parquet`), String(demoId), String(roundNum)) : Promise.resolve([]),
      includeKills ? sqlRound(`SELECT d.*, pa.name AS attacker_name, pv.name AS victim_name, pa.team_start AS attacker_team, pv.team_start AS victim_team FROM damage d JOIN rounds r ON r.demo_id=d.demo_id AND r.round_num=d.round_num LEFT JOIN rounds rn ON rn.demo_id=r.demo_id AND rn.round_num=r.round_num+1 LEFT JOIN players pa ON pa.steam_id=d.attacker_steam_id AND pa.demo_id=d.demo_id LEFT JOIN players pv ON pv.steam_id=d.victim_steam_id AND pv.demo_id=d.demo_id WHERE d.demo_id=@demoId AND d.round_num=@roundNum AND d.tick >= r.start_tick AND d.tick < ISNULL(rn.start_tick, 2147483647) ORDER BY d.tick`) : Promise.resolve([]),
    ])

  const roundData: RoundCache = { positions, kills, grenades, trajectories, smokes, bomb, flash, infernoFires, shots, damage }
  const damageDoneByPlayer = buildDamageDoneSummary(damage)

  writeDebugLog('round.load.main.complete', {
    demoId,
    roundNum,
    durationMs: Date.now() - startedAt,
    sizes: {
      positions: positions.length,
      kills: kills.length,
      grenades: grenades.length,
      smokes: smokes.length,
      bomb: bomb.length,
      flash: flash.length,
      infernoFires: infernoFires.length,
      shots: shots.length,
      damage: damage.length,
      trajectories: trajectories.length,
    },
    damageWindowDiagnostics,
    damageTickRange: damage.length > 0 ? {
      minTick: damage[0]?.tick,
      maxTick: damage[damage.length - 1]?.tick,
    } : null,
    damageDoneByPlayer,
    options,
    damageQueryExecuted: includeKills,
  })
  return roundData
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) {
    return pool
  }

  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(DB_CONFIG)
      .connect()
      .then((connectedPool) => {
        pool = connectedPool
        console.log('[DB] SQL Server connection established')
        return connectedPool
      })
      .finally(() => {
        poolPromise = null
      })
  }

  return poolPromise
}

export function registerDataHandlers() {

  // ── Demo lista ─────────────────────────────────────────────────────────────
  ipcMain.handle('data:getDemos', async () => {
    const p = await getPool()
    const result = await p.request().query(`
      SELECT id, filename, map_name, tickrate, match_id, parsed_at,
             (SELECT COUNT(*) FROM rounds WHERE demo_id = d.id) AS round_count,
             (SELECT COUNT(DISTINCT steam_id) FROM players WHERE demo_id = d.id) AS player_count
      FROM demos d
      ORDER BY parsed_at DESC
    `)
    return result.recordset
  })

  ipcMain.handle('data:getDemoById', async (_, demoId: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .query('SELECT * FROM demos WHERE id = @demoId')
    return result.recordset[0] || null
  })

  ipcMain.handle('data:deleteDemo', async (_, demoId: number) => {
    const p = await getPool()
    // Cascade delete — järjestys on tärkeä FK:iden takia
    const tables = [
      'grenade_trajectories', 'smoke_effects', 'flash_events',
      'utility_damage', 'grenades', 'kills', 'damage',
      'bomb_events', 'purchases', 'shots_fired', 'positions',
      'players', 'rounds', 'demos'
    ]
    for (const table of tables) {
      if (table === 'demos') {
        await p.request().input('id', sql.Int, demoId)
          .query(`DELETE FROM ${table} WHERE id = @id`)
      } else if (table === 'grenade_trajectories' || table === 'smoke_effects') {
        await p.request().input('id', sql.Int, demoId)
          .query(`DELETE FROM ${table} WHERE grenade_id IN (SELECT id FROM grenades WHERE demo_id = @id)`)
      } else {
        await p.request().input('id', sql.Int, demoId)
          .query(`DELETE FROM ${table} WHERE demo_id = @id`)
      }
    }
    return { success: true }
  })

  // ── Roundit ────────────────────────────────────────────────────────────────
  ipcMain.handle('data:getRounds', async (_, demoId: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .query(`
        SELECT r.*,
               (SELECT COUNT(*) FROM kills WHERE demo_id = r.demo_id AND round_num = r.round_num) AS kill_count
        FROM rounds r
        WHERE r.demo_id = @demoId
        ORDER BY r.round_num
      `)
    return result.recordset
  })

  // ── Pelaajat ───────────────────────────────────────────────────────────────
  ipcMain.handle('data:getPlayers', async (_, demoId: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .query('SELECT * FROM players WHERE demo_id = @demoId ORDER BY team_start, name')
    return result.recordset
  })

  // ── Sijainnit — luetaan Parquet-tiedostosta ───────────────────────────────
  ipcMain.handle('data:getPositions', async (_, demoId: number, roundNum: number) => {
    return new Promise((resolve) => {
      const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined
      const appRoot    = isDev ? join(__dirname, '../..') : join(app.getAppPath(), '../..')
      const parquetPath = join(appRoot, 'demos', `${demoId}_positions.parquet`)
      const scriptPath  = join(appRoot, 'python', 'read_positions.py')
      const pythonExe   = join(appRoot, 'python', 'venv', 'Scripts', 'python.exe')
      const outFile     = join(appRoot, 'demos', `_tmp_${demoId}_${roundNum}.json`)

      const proc = spawn(pythonExe, [scriptPath, parquetPath, String(roundNum), outFile], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })

      console.log('[getPositions] pythonExe:', pythonExe)
      console.log('[getPositions] parquetPath:', parquetPath)
      console.log('[getPositions] outFile:', outFile)

      proc.on('error', (e: Error) => {
        console.error('[getPositions] spawn error:', e.message)
      })

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('close', () => {
        try {
          const fs = require('fs')
          if (!fs.existsSync(outFile)) {
            console.error('[getPositions] out file missing, stderr:', stderr)
            resolve([])
            return
          }
          const raw = fs.readFileSync(outFile, 'utf-8')
          fs.unlinkSync(outFile)
          const data = JSON.parse(raw)
          console.log(`[getPositions] demo=${demoId} round=${roundNum} rows=${data.length}`)
          resolve(data)
        } catch (e) {
          console.error('[getPositions] error:', e, 'stderr:', stderr)
          resolve([])
        }
      })
    })
  })

  // ── Tapot ──────────────────────────────────────────────────────────────────
  ipcMain.handle('data:getKills', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT k.*,
               pa.name AS attacker_name,
               pv.name AS victim_name,
               pas.name AS assister_name
        FROM kills k
        LEFT JOIN players pa ON pa.steam_id = k.attacker_steam_id AND pa.demo_id = k.demo_id
        LEFT JOIN players pv ON pv.steam_id = k.victim_steam_id AND pv.demo_id = k.demo_id
        LEFT JOIN players pas ON pas.steam_id = k.assister_steam_id AND pas.demo_id = k.demo_id
        WHERE k.demo_id = @demoId AND k.round_num = @roundNum
        ORDER BY k.tick
      `)
    return result.recordset
  })

  // ── Damage ─────────────────────────────────────────────────────────────────
  ipcMain.handle('data:getDamage', async (_, demoId: number, roundNum: number) => {
    const startedAt = Date.now()
    writeDebugLog('damage.endpoint.request', { demoId, roundNum })
    const p = await getPool()
    let damageWindowDiagnostics: RoundDamageWindowDiagnostics | null = null
    try {
      try {
        damageWindowDiagnostics = await fetchRoundDamageWindowDiagnostics(p, demoId, roundNum)
      } catch (diagError) {
        writeDebugLog('damage.endpoint.window_diagnostics.error', {
          demoId,
          roundNum,
          error: diagError instanceof Error ? diagError.message : String(diagError),
        })
      }
      const result = await p.request()
        .input('demoId', sql.Int, demoId)
        .input('roundNum', sql.Int, roundNum)
        .query(`
          SELECT d.*,
                 pa.name AS attacker_name,
                 pv.name AS victim_name
          FROM damage d
          JOIN rounds r ON r.demo_id = d.demo_id AND r.round_num = d.round_num
          LEFT JOIN rounds rn ON rn.demo_id = r.demo_id AND rn.round_num = r.round_num + 1
          LEFT JOIN players pa ON pa.steam_id = d.attacker_steam_id AND pa.demo_id = d.demo_id
          LEFT JOIN players pv ON pv.steam_id = d.victim_steam_id AND pv.demo_id = d.demo_id
          WHERE d.demo_id = @demoId AND d.round_num = @roundNum
            AND d.tick >= r.start_tick
            AND d.tick < ISNULL(rn.start_tick, 2147483647)
          ORDER BY d.tick
        `)
      writeDebugLog('damage.endpoint.result', {
        demoId,
        roundNum,
        rows: result.recordset.length,
        durationMs: Date.now() - startedAt,
        damageWindowDiagnostics,
        tickRange: result.recordset.length > 0
          ? { minTick: result.recordset[0]?.tick, maxTick: result.recordset[result.recordset.length - 1]?.tick }
          : null,
      })
      return result.recordset
    } catch (error) {
      writeDebugLog('damage.endpoint.error', {
        demoId,
        roundNum,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  // ── Granaatit ──────────────────────────────────────────────────────────────
  ipcMain.handle('data:getGrenades', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT g.*, p.name AS thrower_name
        FROM grenades g
        LEFT JOIN players p ON p.steam_id = g.thrower_steam_id AND p.demo_id = g.demo_id
        WHERE g.demo_id = @demoId AND g.round_num = @roundNum
        ORDER BY g.tick_thrown
      `)
    return result.recordset
  })

  // ── Grenade trajectories — luetaan Parquetista ────────────────────────────
  ipcMain.handle('data:getGrenadeTrajectories', async (_, demoId: number, roundNum: number) => {
    return new Promise((resolve) => {
      const isDev      = process.env['ELECTRON_RENDERER_URL'] !== undefined
      const appRoot    = isDev ? join(__dirname, '../..') : join(app.getAppPath(), '../..')
      const parqPath   = join(appRoot, 'demos', `${demoId}_trajectories.parquet`)
      const outFile    = join(appRoot, 'demos', `_tmp_traj_${demoId}_${roundNum}.json`)
      const scriptPath = join(appRoot, 'python', 'read_trajectories.py')
      const pythonExe  = join(appRoot, 'python', 'venv', 'Scripts', 'python.exe')

      const fs = require('fs')
      if (!fs.existsSync(parqPath)) { resolve([]); return }

      const proc = spawn(pythonExe, [scriptPath, parqPath, String(demoId), String(roundNum), outFile], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })
      let stderr = ''
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('close', () => {
        try {
          if (!fs.existsSync(outFile)) { console.error('[getTraj] stderr:', stderr); resolve([]); return }
          const data = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
          fs.unlinkSync(outFile)
          resolve(data)
        } catch(e) { console.error('[getTraj]', e); resolve([]) }
      })
      proc.on('error', (e: Error) => { console.error('[getTraj] spawn:', e.message); resolve([]) })
    })
  })

  // ── Inferno fire points — luetaan Parquetista ─────────────────────────────
  ipcMain.handle('data:getInfernoFires', async (_, demoId: number, roundNum: number) => {
    return new Promise((resolve) => {
      const isDev      = process.env['ELECTRON_RENDERER_URL'] !== undefined
      const appRoot    = isDev ? join(__dirname, '../..') : join(app.getAppPath(), '../..')
      const parqPath   = join(appRoot, 'demos', `${demoId}_inferno_fires.parquet`)
      const outFile    = join(appRoot, 'demos', `_tmp_inf_${demoId}_${roundNum}.json`)
      const scriptPath = join(appRoot, 'python', 'read_inferno_fires.py')
      const pythonExe  = join(appRoot, 'python', 'venv', 'Scripts', 'python.exe')

      const fs = require('fs')
      if (!fs.existsSync(parqPath)) { resolve([]); return }

      const proc = spawn(pythonExe, [scriptPath, parqPath, String(demoId), String(roundNum), outFile], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })
      let stderr = ''
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('close', () => {
        try {
          if (!fs.existsSync(outFile)) { console.error('[getInfernoFires] stderr:', stderr); resolve([]); return }
          const data = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
          fs.unlinkSync(outFile)
          resolve(data)
        } catch(e) { console.error('[getInfernoFires]', e); resolve([]) }
      })
      proc.on('error', (e: Error) => { console.error('[getInfernoFires] spawn:', e.message); resolve([]) })
    })
  })

  ipcMain.handle('data:getSmokeEffects', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT se.*
        FROM smoke_effects se
        INNER JOIN grenades g ON g.id = se.grenade_id
        WHERE g.demo_id = @demoId AND g.round_num = @roundNum
      `)
    return result.recordset
  })

  // ── Flash ──────────────────────────────────────────────────────────────────
  ipcMain.handle('data:getFlashEvents', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT fe.*, pt.name AS thrower_name, pb.name AS blinded_name
        FROM flash_events fe
        LEFT JOIN players pt ON pt.steam_id = fe.thrower_steam_id AND pt.demo_id = fe.demo_id
        LEFT JOIN players pb ON pb.steam_id = fe.blinded_steam_id AND pb.demo_id = fe.demo_id
        WHERE fe.demo_id = @demoId AND fe.round_num = @roundNum
        ORDER BY fe.tick
      `)
    return result.recordset
  })

  // ── Pommi ──────────────────────────────────────────────────────────────────
  ipcMain.handle('data:getBombEvents', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT be.*, p.name AS player_name
        FROM bomb_events be
        LEFT JOIN players p ON p.steam_id = be.player_steam_id AND p.demo_id = be.demo_id
        WHERE be.demo_id = @demoId AND be.round_num = @roundNum
        ORDER BY be.tick
      `)
    return result.recordset
  })

  // ── Laukaukset ─────────────────────────────────────────────────────────────
  ipcMain.handle('data:getShotsFired', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT sf.*, p.name AS player_name
        FROM shots_fired sf
        LEFT JOIN players p ON p.steam_id = sf.steam_id AND p.demo_id = sf.demo_id
        WHERE sf.demo_id = @demoId AND sf.round_num = @roundNum
        ORDER BY sf.tick
      `)
    return result.recordset
  })

  // ── Heatmap (kaikki roundit / optionaalinen pelaaja) ───────────────────────
  ipcMain.handle('data:getHeatmapPositions', async (_, demoId: number, steamId?: string) => {
    const p = await getPool()
    const req = p.request().input('demoId', sql.Int, demoId)
    let query = `
      SELECT x, y, COUNT(*) as weight
      FROM positions
      WHERE demo_id = @demoId AND is_alive = 1
    `
    if (steamId) {
      req.input('steamId', sql.BigInt, steamId)
      query += ' AND steam_id = @steamId'
    }
    query += ' GROUP BY ROUND(x/50)*50, ROUND(y/50)*50'  // 50-unit buckets
    const result = await req.query(query)
    return result.recordset
  })

  // ── Kaikki kierroksen data yhdellä kutsulla ───────────────────────────────
  ipcMain.handle('data:loadRoundAll', async (_, demoId: number, roundNum: number, options?: RoundLoadOptions) => {
    const startedAt = Date.now()
    writeDebugLog('round.load.endpoint.request', { demoId, roundNum, options })
    try {
      const result = await loadRoundData(demoId, roundNum, options)
      writeDebugLog('round.load.endpoint.result', {
        demoId,
        roundNum,
        durationMs: Date.now() - startedAt,
        options,
        sizes: {
          positions: result.positions.length,
          kills: result.kills.length,
          damage: result.damage.length,
          grenades: result.grenades.length,
          smokes: result.smokes.length,
          shots: result.shots.length,
          trajectories: result.trajectories.length,
        },
      })
      return result
    } catch (error) {
      writeDebugLog('round.load.endpoint.error', {
        demoId,
        roundNum,
        durationMs: Date.now() - startedAt,
        options,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  // ── Kumulatiiviset tilastot suoraan SQL:stä ───────────────────────────────
  ipcMain.handle('data:getCumulativeStats', async (_, demoId: number, upToRound: number) => {
    const startedAt = Date.now()
    writeDebugLog('damage.cumulative.request', { demoId, upToRound })
    const p = await getPool()
    try {
      const [kills, damage, flash] = await Promise.all([
      p.request()
        .input('demoId', sql.Int, demoId)
        .input('upToRound', sql.Int, upToRound)
        .query(`
          SELECT attacker_steam_id AS steam_id,
            COUNT(*) AS kills,
            SUM(CASE WHEN headshot=1 THEN 1 ELSE 0 END) AS hs,
            0 AS deaths, 0 AS assists
          FROM kills k
          JOIN rounds r ON r.demo_id=k.demo_id AND r.round_num=k.round_num
          WHERE k.demo_id=@demoId AND k.round_num < @upToRound AND k.round_num > 0 AND ISNULL(r.is_knife,0)=0
          GROUP BY attacker_steam_id
          UNION ALL
          SELECT victim_steam_id, 0, 0, COUNT(*), 0
          FROM kills k JOIN rounds r ON r.demo_id=k.demo_id AND r.round_num=k.round_num
          WHERE k.demo_id=@demoId AND k.round_num < @upToRound AND k.round_num > 0 AND ISNULL(r.is_knife,0)=0
          GROUP BY victim_steam_id
          UNION ALL
          SELECT assister_steam_id, 0, 0, 0, COUNT(*)
          FROM kills k JOIN rounds r ON r.demo_id=k.demo_id AND r.round_num=k.round_num
          WHERE k.demo_id=@demoId AND k.round_num < @upToRound AND k.round_num > 0
            AND assister_steam_id IS NOT NULL AND ISNULL(r.is_knife,0)=0
          GROUP BY assister_steam_id
        `),
      p.request()
        .input('demoId', sql.Int, demoId)
        .input('upToRound', sql.Int, upToRound)
        .query(`
          WITH dmg_grouped AS (
            SELECT
              d.attacker_steam_id,
              d.round_num,
              d.victim_steam_id,
              SUM(d.damage) AS dmg_sum,
              SUM(CASE WHEN REPLACE(d.weapon,'weapon_','') IN ('hegrenade','molotov','incgrenade') THEN d.damage ELSE 0 END) AS util_dmg_sum
            FROM damage d
            JOIN players pa ON pa.demo_id=d.demo_id AND pa.steam_id=d.attacker_steam_id
            JOIN players pv ON pv.demo_id=d.demo_id AND pv.steam_id=d.victim_steam_id
            JOIN rounds r ON r.demo_id=d.demo_id AND r.round_num=d.round_num
            LEFT JOIN rounds rn ON rn.demo_id=r.demo_id AND rn.round_num=r.round_num+1
            WHERE d.demo_id=@demoId AND d.round_num < @upToRound AND d.round_num > 0 AND ISNULL(r.is_knife,0)=0
              AND pa.team_start <> pv.team_start
              AND d.tick >= r.start_tick
              AND d.tick < ISNULL(rn.start_tick, 2147483647)
            GROUP BY d.attacker_steam_id, d.round_num, d.victim_steam_id
          )
          SELECT
            attacker_steam_id AS steam_id,
            SUM(CASE WHEN dmg_sum > 100 THEN 100 ELSE dmg_sum END) AS total_damage,
            SUM(CASE WHEN util_dmg_sum > 100 THEN 100 ELSE util_dmg_sum END) AS util_damage
          FROM dmg_grouped
          GROUP BY attacker_steam_id
        `),
      p.request()
        .input('demoId', sql.Int, demoId)
        .input('upToRound', sql.Int, upToRound)
        .query(`
          SELECT fe.thrower_steam_id AS steam_id,
            COUNT(*) AS enemies_flashed,
            SUM(fe.flash_duration) AS flash_duration
          FROM flash_events fe
          JOIN players pt ON pt.steam_id=fe.thrower_steam_id AND pt.demo_id=fe.demo_id
          JOIN players pb ON pb.steam_id=fe.blinded_steam_id  AND pb.demo_id=fe.demo_id
          JOIN rounds r   ON r.demo_id=fe.demo_id AND r.round_num=fe.round_num
          WHERE fe.demo_id=@demoId AND fe.round_num < @upToRound AND fe.round_num > 0
            AND pt.team_start <> pb.team_start AND ISNULL(r.is_knife,0)=0
            AND ISNULL(fe.match_quality,'unmatched') IN ('player_blind_event','detonation_window','entity_tick','exact_handle','spatial_strict')
          GROUP BY fe.thrower_steam_id
        `),
    ])
      writeDebugLog('damage.cumulative.result', {
        demoId,
        upToRound,
        rows: damage.recordset.length,
        durationMs: Date.now() - startedAt,
        totalDamage: damage.recordset.reduce((acc: number, r: any) => acc + Number(r.total_damage ?? 0), 0),
        totalUtilDamage: damage.recordset.reduce((acc: number, r: any) => acc + Number(r.util_damage ?? 0), 0),
        topPlayers: damage.recordset
          .slice()
          .sort((a: any, b: any) => Number(b.total_damage ?? 0) - Number(a.total_damage ?? 0))
          .slice(0, 5)
          .map((r: any) => ({ steamId: r.steam_id, totalDamage: r.total_damage, utilDamage: r.util_damage })),
      })
      return { kills: kills.recordset, damage: damage.recordset, flash: flash.recordset }
    } catch (error) {
      writeDebugLog('damage.cumulative.error', {
        demoId,
        upToRound,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })

  ipcMain.handle('debug:log', async (_, event: string, payload?: unknown) => {
    writeDebugLog(event, payload)
    return { ok: true }
  })

  ipcMain.handle('debug:getLogPath', async () => {
    return getDebugLogPath()
  })
}
