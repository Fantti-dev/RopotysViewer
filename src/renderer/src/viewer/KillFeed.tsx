import { usePlaybackStore, useDemoStore } from '../stores'

const KILL_FEED_TICKS = 384

const WEAPON_FI: Record<string, string> = {
  ak47:'AK-47', aug:'AUG', awp:'AWP', bizon:'PP-Bizon', cz75a:'CZ75',
  deagle:'Deagle', famas:'FAMAS', fiveseven:'Five-7', g3sg1:'G3SG1',
  galil:'Galil', galilar:'Galil', glock:'Glock', hegrenade:'HE-kranaatti',
  flashbang:'Sokaisija', incgrenade:'Polttokranaatti', molotov:'Molotov',
  smokegrenade:'Savukranaatti', m249:'M249', m4a1:'M4A1',
  m4a1_silencer:'M4A1-S', m4a4:'M4A4', mac10:'MAC-10', mag7:'MAG-7',
  mp5sd:'MP5-SD', mp7:'MP7', mp9:'MP9', negev:'Negev', nova:'Nova',
  p2000:'P2000', p250:'P250', p90:'P90', revolver:'R8', sawedoff:'Sawed-Off',
  scar20:'SCAR-20', sg553:'SG 553', sg556:'SG 553', ssg08:'SSG 08',
  tec9:'Tec-9', ump45:'UMP-45', usp_silencer:'USP-S', xm1014:'XM1014',
  zeus:'Zeus', knife:'Veitsi', knife_t:'Veitsi', c4:'Pommi', planted_c4:'Pommi',
  world:'Putoaminen',
}

function weaponLabel(raw: string | null | undefined): string {
  if (!raw) return '?'
  const key = raw.replace('weapon_','').toLowerCase()
  return WEAPON_FI[key] ?? raw.replace('weapon_','').replace(/_/g,' ')
}

export default function KillFeed() {
  const { kills, currentTick } = usePlaybackStore()
  const { players } = useDemoStore()

  const visible = kills
    .filter(k => k.tick <= currentTick && currentTick - k.tick <= KILL_FEED_TICKS)
    .slice(-6)
    .reverse()

  if (visible.length === 0) return null

  const teamMap: Record<string, 'CT' | 'T'> = {}
  players.forEach(p => { teamMap[String(p.steam_id)] = p.team_start })

  const nameColor = (id: string) => teamMap[String(id)] === 'CT' ? '#5b9cf6' : '#f97316'

  return (
    <div style={{
      position:'absolute', top:10, right:10,
      display:'flex', flexDirection:'column', gap:3,
      zIndex:50, pointerEvents:'none', minWidth:220,
    }}>
      {visible.map((k, i) => {
        const age      = currentTick - k.tick
        const opacity  = Math.max(0.3, 1 - (age / KILL_FEED_TICKS) * 0.7)
        const weapon   = weaponLabel(k.weapon)

        return (
          <div key={k.id ?? i} style={{
            display:'flex', alignItems:'center', gap:5,
            background:'rgba(10,12,20,0.82)',
            borderRadius:8, padding:'4px 10px',
            opacity,
            border:'1px solid rgba(255,255,255,0.08)',
            backdropFilter:'blur(4px)',
          }}>
            {/* Hyökkääjä */}
            <span style={{
              fontSize:11, fontWeight:700,
              color: nameColor(k.attacker_steam_id),
              maxWidth:85, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap',
            }}>{k.attacker_name}</span>

            {/* Erikoismerkit */}
            <div style={{ display:'flex', gap:2, flexShrink:0 }}>
              {k.wallbang  && <span style={{ fontSize:8, color:'#fbbf24', background:'rgba(251,191,36,0.15)', padding:'1px 3px', borderRadius:3 }} title="Seinän läpi">WB</span>}
              {k.thrusmoke && <span style={{ fontSize:8, color:'#9ca3af', background:'rgba(156,163,175,0.15)', padding:'1px 3px', borderRadius:3 }} title="Savun läpi">SM</span>}
              {k.blind     && <span style={{ fontSize:8, color:'#818cf8', background:'rgba(129,140,248,0.15)', padding:'1px 3px', borderRadius:3 }} title="Sokaistuneena">BL</span>}
              {k.noscope   && <span style={{ fontSize:8, color:'#f87171', background:'rgba(248,113,113,0.15)', padding:'1px 3px', borderRadius:3 }} title="No scope">NS</span>}
            </div>

            {/* Ase */}
            <span style={{
              fontSize:9, fontWeight:600,
              color:'#e2e8f0',
              background:'rgba(255,255,255,0.08)',
              padding:'1px 6px', borderRadius:4,
              whiteSpace:'nowrap', flexShrink:0,
            }}>{weapon}</span>

            {/* Headshot */}
            {k.headshot && (
              <span style={{
                fontSize:8, fontWeight:700,
                color:'#ef4444',
                background:'rgba(239,68,68,0.15)',
                padding:'1px 4px', borderRadius:3,
                flexShrink:0,
              }}>HS</span>
            )}

            {/* Uhri */}
            <span style={{
              fontSize:11, fontWeight:700,
              color: nameColor(k.victim_steam_id),
              maxWidth:85, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap',
            }}>{k.victim_name}</span>
          </div>
        )
      })}
    </div>
  )
}