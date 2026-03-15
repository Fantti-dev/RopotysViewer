import { useMemo, useState, useEffect } from 'react'
import { usePlaybackStore, useDemoStore, useSelectedPlayerStore } from '../stores'
import { KNIFE_ROUND } from './RoundSelector'

const UTIL_GRENADES = new Set(['hegrenade','molotov','incgrenade'])

interface PlayerStats {
  name: string
  team: string
  kills: number
  deaths: number
  assists: number
  hs: number
  enemiesFlashed: number
  flashDuration: number
  utilDamage: number
  totalDamage: number
  roundsPlayed: number
}

export default function RoundScoreboard({ onClose }: { onClose: () => void }) {
  const { kills, flashEvents, damage, positions, currentTick, currentRound } = usePlaybackStore()
  const { players, rounds, selectedDemo } = useDemoStore()
  const { steamId: selectedId, setSteamId } = useSelectedPlayerStore()

  const currentRoundData = rounds.find(r => r.round_num === currentRound)
  const isKnifeRound = currentRound === KNIFE_ROUND || (currentRoundData?.is_knife ?? false)

  // Hae historialliset tilastot SQL:stä (kaikki kierrokset < currentRound)
  const [sqlStats, setSqlStats] = useState<{ kills: any[], damage: any[], flash: any[] } | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!selectedDemo || isKnifeRound || currentRound <= 1) {
      setSqlStats(null)
      return
    }
    setLoadingHistory(true)
    window.electronAPI.getCumulativeStats(selectedDemo.id, currentRound)
      .then(data => { setSqlStats(data); setLoadingHistory(false) })
      .catch(() => { setSqlStats(null); setLoadingHistory(false) })
  }, [selectedDemo?.id, currentRound, isKnifeRound])

  if (!selectedDemo) return (
    <div style={{
      position:'absolute', top:0, left:0, right:0, bottom:0, zIndex:45,
      background:'rgba(10,12,20,0.96)', display:'flex', alignItems:'center', justifyContent:'center',
      backdropFilter:'blur(4px)',
    }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:14, color:'#4b5563', marginBottom:8 }}>Valitse demo ensin</div>
        <button onClick={onClose} style={{ background:'#f97316', border:'none', color:'#fff', padding:'6px 16px', borderRadius:8, cursor:'pointer', fontSize:11 }}>Sulje</button>
      </div>
    </div>
  )

  // Laske kumulatiiviset tilastot: kaikki päättyneet kierrokset + nykyinen tick:iin asti
  const stats = useMemo(() => {
    if (!selectedDemo) return []

    const map = new Map<string, PlayerStats>()
    const historyRoundsPlayed = rounds.filter(r => !r.is_knife && r.round_num > 0 && r.round_num < currentRound).length

    players.forEach(p => {
      map.set(String(p.steam_id), {
        name: p.name, team: p.team_start,
        kills:0, deaths:0, assists:0, hs:0,
        enemiesFlashed:0, flashDuration:0,
        utilDamage:0, totalDamage:0, roundsPlayed:historyRoundsPlayed,
      })
    })

    // ── Historia suoraan SQL:stä ───────────────────────────────────────────
    if (sqlStats) {
      sqlStats.kills.forEach((r: any) => {
        const s = map.get(String(r.steam_id))
        if (!s) return
        s.kills   += r.kills   ?? 0
        s.deaths  += r.deaths  ?? 0
        s.assists += r.assists ?? 0
        s.hs      += r.hs      ?? 0
      })
      sqlStats.damage.forEach((r: any) => {
        const s = map.get(String(r.steam_id))
        if (!s) return
        s.totalDamage  += r.total_damage ?? 0
        s.utilDamage   += r.util_damage  ?? 0
      })
      sqlStats.flash.forEach((r: any) => {
        const s = map.get(String(r.steam_id))
        if (!s) return
        s.enemiesFlashed += r.enemies_flashed ?? 0
        s.flashDuration  += r.flash_duration  ?? 0
      })
    }

    // ── Nykyinen kierros — live currentTick:iin asti ──────────────────────
    if (!isKnifeRound) {
      const currentRoundParticipants = new Set<string>()

      positions.filter(p => p.tick <= currentTick).forEach((p) => {
        const sid = String(p.steam_id)
        if (map.has(sid)) currentRoundParticipants.add(sid)
      })

      kills.filter(k => k.tick <= currentTick).forEach(k => {
        const attackerId = String(k.attacker_steam_id)
        const victimId = String(k.victim_steam_id)
        const assisterId = k.assister_steam_id ? String(k.assister_steam_id) : null

        const atk = map.get(attackerId)
        const vic = map.get(victimId)
        const ast = assisterId ? map.get(assisterId) : null

        if (atk) {
          atk.kills++
          if (k.headshot) atk.hs++
          currentRoundParticipants.add(attackerId)
        }
        if (vic) {
          vic.deaths++
          currentRoundParticipants.add(victimId)
        }
        if (ast && assisterId) {
          ast.assists++
          currentRoundParticipants.add(assisterId)
        }
      })

      flashEvents.filter(f => f.tick <= currentTick).forEach(f => {
        if (f.match_quality && f.match_quality === "unmatched") return
        if (!f.thrower_steam_id) return

        const throwerId = String(f.thrower_steam_id)
        const thrower = map.get(throwerId)
        const blinded = map.get(String(f.blinded_steam_id))
        if (thrower && blinded && blinded.team !== thrower.team) {
          thrower.enemiesFlashed++
          thrower.flashDuration += f.flash_duration ?? 0
          currentRoundParticipants.add(throwerId)
        }
      })

      damage.filter(d => d.tick <= currentTick).forEach(d => {
        const attackerId = String(d.attacker_steam_id)
        const atk = map.get(attackerId)
        if (!atk) return
        atk.totalDamage += d.damage ?? 0
        if (UTIL_GRENADES.has((d.weapon ?? '').replace('weapon_', ''))) {
          atk.utilDamage += d.damage ?? 0
        }
        currentRoundParticipants.add(attackerId)
      })

      currentRoundParticipants.forEach((steamId) => {
        const player = map.get(steamId)
        if (player) player.roundsPlayed++
      })
    }

    return Array.from(map.values())
  }, [sqlStats, kills, flashEvents, damage, positions, currentTick, players, rounds, currentRound, isKnifeRound])

  const ct = stats.filter(s => s.team === 'CT').sort((a, b) => b.kills - a.kills)
  const t  = stats.filter(s => s.team === 'T').sort((a, b) => b.kills - a.kills)

  const loadedRounds = Math.max(currentRound - 1, 0)
  const totalHistoryRounds = rounds.filter(r => !r.is_knife && r.round_num < currentRound).length

  // Sarakeleveydet — lisätty Flash # ja Flash s erillisinä
  const COL_W =    [120, 36, 36, 36, 40, 52, 44, 52, 60]
  const HEADERS =  ['Pelaaja', 'K', 'K/K', 'A', 'HS%', 'ADR', 'Flash #', 'Flash s', 'Util dmg']

  const Row = ({ s }: { s: PlayerStats }) => {
    const pid      = players.find(p => p.name === s.name)?.steam_id?.toString()
    const selected = selectedId === pid
    const rounds   = Math.max(s.roundsPlayed, 1)
    const adr      = Math.round(s.totalDamage / rounds)
    const hsPct    = s.kills > 0 ? Math.round((s.hs / s.kills) * 100) + '%' : '—'

    return (
      <div
        onClick={() => setSteamId(selected ? null : (pid ?? null))}
        style={{
          display:'flex', alignItems:'center', padding:'4px 0', borderRadius:6,
          background: selected ? 'rgba(249,115,22,0.12)' : 'transparent',
          cursor:'pointer', transition:'background .1s',
        }}
        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <Cell w={COL_W[0]} left>
          <span style={{ fontSize:11, fontWeight:600, color: selected ? '#f97316' : '#e2e8f0' }}>
            {selected ? '▶ ' : ''}{s.name}
          </span>
        </Cell>
        <Cell w={COL_W[1]}><Num v={s.kills}   color='#e2e8f0' bold /></Cell>
        <Cell w={COL_W[2]}><Num v={s.deaths}  color='#9ca3af' /></Cell>
        <Cell w={COL_W[3]}><Num v={s.assists} color='#9ca3af' /></Cell>
        <Cell w={COL_W[4]}>
          <span style={{ fontSize:10, color: s.kills > 0 && s.hs/s.kills > 0.5 ? '#f97316' : '#9ca3af' }}>
            {hsPct}
          </span>
        </Cell>
        <Cell w={COL_W[5]}>
          <span style={{ fontSize:10, fontVariantNumeric:'tabular-nums',
            color: adr > 80 ? '#22c55e' : adr > 50 ? '#e2e8f0' : '#9ca3af' }}>
            {adr || '—'}
          </span>
        </Cell>
        <Cell w={COL_W[6]}>
          <span style={{ fontSize:10, color: s.enemiesFlashed > 0 ? '#fbbf24' : '#4b5563',
            fontVariantNumeric:'tabular-nums' }}>
            {s.enemiesFlashed || '—'}
          </span>
        </Cell>
        <Cell w={COL_W[7]}>
          <span style={{ fontSize:10, color: s.flashDuration > 0 ? '#fbbf24' : '#4b5563',
            fontVariantNumeric:'tabular-nums' }}>
            {s.flashDuration > 0 ? s.flashDuration.toFixed(1) + 's' : '—'}
          </span>
        </Cell>
        <Cell w={COL_W[8]}>
          <Num v={s.utilDamage} color={s.utilDamage > 0 ? '#f59e0b' : '#4b5563'} />
        </Cell>
      </div>
    )
  }

  return (
    <div style={{
      position:'absolute', top:0, left:0, right:0, bottom:0, zIndex:45,
      background:'rgba(10,12,20,0.96)',
      display:'flex', flexDirection:'column',
      backdropFilter:'blur(4px)',
    }}>
      {/* Header */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 16px 8px', borderBottom:'1px solid #1e2130', flexShrink:0,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>Tilastot</span>
          {isKnifeRound
            ? <span style={{ fontSize:10, color:'#f59e0b', background:'rgba(245,158,11,0.12)', padding:'2px 8px', borderRadius:6, border:'1px solid rgba(245,158,11,0.3)' }}>
                🔪 Puukkokierros
              </span>
            : loadingHistory
            ? <span style={{ fontSize:9, color:'#f59e0b', fontFamily:'monospace' }}>
                ⏳ Ladataan historiaa... {loadedRounds}/{totalHistoryRounds}
              </span>
            : <span style={{ fontSize:9, color:'#4b5563', fontFamily:'monospace' }}>
                Kierros {currentRound} · tick {currentTick.toLocaleString()} · kumulatiivinen
              </span>
          }
        </div>
        <button onClick={onClose}
          style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:18 }}>✕</button>
      </div>

      {/* Sarakeotsikit */}
      <div style={{ display:'flex', padding:'4px 8px', flexShrink:0 }}>
        {HEADERS.map((h, i) => (
          <div key={h} style={{
            width:COL_W[i], flexShrink:0, fontSize:9, fontWeight:700,
            letterSpacing:'.6px', color:'#4b5563',
            textAlign: i === 0 ? 'left' : 'center', textTransform:'uppercase',
          }}>{h}</div>
        ))}
      </div>

      {/* CT */}
      <TeamSection label="COUNTER-TERRORISTS" color="#5b9cf6" rows={ct} Row={Row} />
      {/* T */}
      <TeamSection label="TERRORISTS" color="#f97316" rows={t} Row={Row} />

      {/* Merkintä */}
      <div style={{ padding:'6px 16px', borderTop:'1px solid #1e2130', flexShrink:0, display:'flex', gap:14, flexWrap:'wrap', alignItems:'center' }}>
        {[
          ['K','Tapot'], ['K/K','Kuolemat'], ['A','Assistit'], ['HS%','Headshot-%'],
          ['ADR','Avg damage / round'], ['Flash #','Vihollisia sokaistuna (kpl)'],
          ['Flash s','Sokaisuaika sekunteina'], ['Util dmg','Kranaattidamage'],
        ].map(([k,v]) => (
          <span key={k} style={{ fontSize:9, color:'#4b5563' }}>
            <span style={{ color:'#6b7280', fontWeight:700 }}>{k}</span> = {v}
          </span>
        ))}
        <span style={{ fontSize:9, color:'#f97316', marginLeft:'auto' }}>Klikkaa → POV-seuranta</span>
      </div>
    </div>
  )
}

function Cell({ w, children, left }: { w:number, children:React.ReactNode, left?:boolean }) {
  return (
    <div style={{ width:w, flexShrink:0, textAlign: left ? 'left' : 'center', padding:'0 3px' }}>
      {children}
    </div>
  )
}

function Num({ v, color, bold }: { v:number, color:string, bold?:boolean }) {
  return (
    <span style={{ fontSize:11, fontWeight: bold ? 700 : 400, color, fontVariantNumeric:'tabular-nums' }}>
      {v > 0 ? v : '—'}
    </span>
  )
}

function TeamSection({ label, color, rows, Row }: {
  label:string, color:string,
  rows: PlayerStats[], Row: (p:{s:PlayerStats}) => JSX.Element
}) {
  return (
    <div style={{ padding:'4px 8px 6px', flexShrink:0 }}>
      <div style={{
        fontSize:9, fontWeight:700, letterSpacing:'.8px', color,
        borderLeft:`2px solid ${color}`, paddingLeft:8, marginBottom:3,
      }}>{label}</div>
      {rows.map((s,i) => <Row key={i} s={s} />)}
    </div>
  )
}
