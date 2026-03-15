import { ipcMain, app } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
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

// ── Kierrosdatan lataus (ilman main-prosessin välimuistia) ───────────────────
// Standalone funktio — käytettävissä sekä IPC-handlereissa että preloadissa
async function loadRoundData(demoId: number, roundNum: number): Promise<RoundCache> {
  const t0 = Date.now()

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

  const [positions, kills, grenades, smokes, bomb, flash, shots, trajectories, infernoFires, damage] =
    await Promise.all([
      runPy(join(appRoot,'python','read_positions.py'),    join(appRoot,'demos',`${demoId}_positions.parquet`),     String(roundNum)),
      sqlRound(`SELECT k.*, pa.name AS attacker_name, pv.name AS victim_name, pas.name AS assister_name FROM kills k LEFT JOIN players pa ON pa.steam_id=k.attacker_steam_id AND pa.demo_id=k.demo_id LEFT JOIN players pv ON pv.steam_id=k.victim_steam_id AND pv.demo_id=k.demo_id LEFT JOIN players pas ON pas.steam_id=k.assister_steam_id AND pas.demo_id=k.demo_id WHERE k.demo_id=@demoId AND k.round_num=@roundNum ORDER BY k.tick`),
      sqlRound(`SELECT g.*, p.name AS thrower_name FROM grenades g LEFT JOIN players p ON p.steam_id=g.thrower_steam_id AND p.demo_id=g.demo_id WHERE g.demo_id=@demoId AND g.round_num=@roundNum ORDER BY g.tick_thrown`),
      sqlRound(`SELECT se.* FROM smoke_effects se INNER JOIN grenades g ON g.id=se.grenade_id WHERE g.demo_id=@demoId AND g.round_num=@roundNum ORDER BY se.start_tick`),
      sqlRound(`SELECT be.*, p.name AS player_name FROM bomb_events be LEFT JOIN players p ON p.steam_id=be.player_steam_id AND p.demo_id=be.demo_id WHERE be.demo_id=@demoId AND be.round_num=@roundNum ORDER BY be.tick`),
      sqlRound(`SELECT fe.*, pt.name AS thrower_name, pb.name AS blinded_name FROM flash_events fe LEFT JOIN players pt ON pt.steam_id=fe.thrower_steam_id AND pt.demo_id=fe.demo_id LEFT JOIN players pb ON pb.steam_id=fe.blinded_steam_id AND pb.demo_id=fe.demo_id WHERE fe.demo_id=@demoId AND fe.round_num=@roundNum ORDER BY fe.tick`),
      sqlRound(`SELECT sf.*, p.name AS player_name FROM shots_fired sf LEFT JOIN players p ON p.steam_id=sf.steam_id AND p.demo_id=sf.demo_id WHERE sf.demo_id=@demoId AND sf.round_num=@roundNum ORDER BY sf.tick`),
      runPy(join(appRoot,'python','read_trajectories.py'), join(appRoot,'demos',`${demoId}_trajectories.parquet`),  String(demoId), String(roundNum)),
      runPy(join(appRoot,'python','read_inferno_fires.py'),join(appRoot,'demos',`${demoId}_inferno_fires.parquet`), String(demoId), String(roundNum)),
      sqlRound(`SELECT d.*, pa.name AS attacker_name, pv.name AS victim_name FROM damage d LEFT JOIN players pa ON pa.steam_id=d.attacker_steam_id AND pa.demo_id=d.demo_id LEFT JOIN players pv ON pv.steam_id=d.victim_steam_id AND pv.demo_id=d.demo_id WHERE d.demo_id=@demoId AND d.round_num=@roundNum ORDER BY d.tick`),
    ])

  const roundData: RoundCache = { positions, kills, grenades, trajectories, smokes, bomb, flash, infernoFires, shots, damage }
  return roundData
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = await new sql.ConnectionPool(DB_CONFIG).connect()
    console.log('[DB] SQL Server connection established')
  }
  return pool
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
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT d.*,
               pa.name AS attacker_name,
               pv.name AS victim_name
        FROM damage d
        LEFT JOIN players pa ON pa.steam_id = d.attacker_steam_id AND pa.demo_id = d.demo_id
        LEFT JOIN players pv ON pv.steam_id = d.victim_steam_id AND pv.demo_id = d.demo_id
        WHERE d.demo_id = @demoId AND d.round_num = @roundNum
        ORDER BY d.tick
      `)
    return result.recordset
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
  ipcMain.handle('data:loadRoundAll', async (_, demoId: number, roundNum: number) => {
    return loadRoundData(demoId, roundNum)
  })

  // ── Kumulatiiviset tilastot suoraan SQL:stä ───────────────────────────────
  ipcMain.handle('data:getCumulativeStats', async (_, demoId: number, upToRound: number) => {
    const p = await getPool()
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
          WHERE k.demo_id=@demoId AND k.round_num < @upToRound AND ISNULL(r.is_knife,0)=0
          GROUP BY attacker_steam_id
          UNION ALL
          SELECT victim_steam_id, 0, 0, COUNT(*), 0
          FROM kills k JOIN rounds r ON r.demo_id=k.demo_id AND r.round_num=k.round_num
          WHERE k.demo_id=@demoId AND k.round_num < @upToRound AND ISNULL(r.is_knife,0)=0
          GROUP BY victim_steam_id
          UNION ALL
          SELECT assister_steam_id, 0, 0, 0, COUNT(*)
          FROM kills k JOIN rounds r ON r.demo_id=k.demo_id AND r.round_num=k.round_num
          WHERE k.demo_id=@demoId AND k.round_num < @upToRound
            AND assister_steam_id IS NOT NULL AND ISNULL(r.is_knife,0)=0
          GROUP BY assister_steam_id
        `),
      p.request()
        .input('demoId', sql.Int, demoId)
        .input('upToRound', sql.Int, upToRound)
        .query(`
          SELECT d.attacker_steam_id AS steam_id,
            SUM(d.damage) AS total_damage,
            SUM(CASE WHEN REPLACE(d.weapon,'weapon_','') IN ('hegrenade','molotov','incgrenade')
              THEN d.damage ELSE 0 END) AS util_damage,
            COUNT(DISTINCT d.round_num) AS rounds_played
          FROM damage d
          JOIN rounds r ON r.demo_id=d.demo_id AND r.round_num=d.round_num
          WHERE d.demo_id=@demoId AND d.round_num < @upToRound AND ISNULL(r.is_knife,0)=0
          GROUP BY d.attacker_steam_id
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
          WHERE fe.demo_id=@demoId AND fe.round_num < @upToRound
            AND pt.team_start <> pb.team_start AND ISNULL(r.is_knife,0)=0
          GROUP BY fe.thrower_steam_id
        `),
    ])
    return { kills: kills.recordset, damage: damage.recordset, flash: flash.recordset }
  })
}