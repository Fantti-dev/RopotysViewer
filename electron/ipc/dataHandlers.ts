import { ipcMain } from 'electron'
import sql from 'mssql'

// ── SQL Server konfiguraatio ──────────────────────────────────────────────────
// Muuta nämä omiin asetuksiisi!
const DB_CONFIG: sql.config = {
  server: 'localhost',
  database: 'cs2demos',
  options: {
    trustedConnection: true,    // Windows Authentication (ei tarvitse salasanaa)
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

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = await new sql.ConnectionPool(DB_CONFIG).connect()
    console.log('✅ SQL Server yhteys muodostettu')
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

  // ── Sijainnit ──────────────────────────────────────────────────────────────
  ipcMain.handle('data:getPositions', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT tick, steam_id, x, y, z, yaw, pitch,
               velocity_x, velocity_y, velocity_z,
               is_alive, is_ducking, is_scoped, is_airborne, is_blinded,
               health, armor, helmet, active_weapon, equip_value
        FROM positions
        WHERE demo_id = @demoId AND round_num = @roundNum
        ORDER BY tick, steam_id
      `)
    return result.recordset
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

  ipcMain.handle('data:getGrenadeTrajectories', async (_, demoId: number, roundNum: number) => {
    const p = await getPool()
    const result = await p.request()
      .input('demoId', sql.Int, demoId)
      .input('roundNum', sql.Int, roundNum)
      .query(`
        SELECT gt.*
        FROM grenade_trajectories gt
        INNER JOIN grenades g ON g.id = gt.grenade_id
        WHERE g.demo_id = @demoId AND g.round_num = @roundNum
        ORDER BY gt.grenade_id, gt.tick
      `)
    return result.recordset
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
}
