import { useDemoStore, usePlaybackStore } from '../stores'

// demoparser2 weapon_name → ikoni-tiedostonimi (ilman -icon.svg)
const WEAPON_ICON: Record<string, string> = {
  ak47:              'ak47',
  aug:               'aug',
  awp:               'awp',
  bizon:             'bizon',
  cz75a:             'cz75a',
  deagle:            'deagle',
  decoy:             'decoy',
  famas:             'famas',
  fiveseven:         'five-seven',
  g3sg1:             'g3sg1',
  galil:             'galilar',
  galilar:           'galilar',
  glock:             'glock',
  hegrenade:         'he-grenade',
  flashbang:         'flashbang',
  incgrenade:        'incendiary-grenade',
  molotov:           'molotov',
  smokegrenade:      'smoke-grenade',
  m249:              'm249',
  m4a1:              'm4a1',
  m4a1_silencer:     'm4a1-silencer-off',
  m4a4:              'm4a4',
  mac10:             'mac10',
  mag7:              'mag7',
  mp5sd:             'mp5sd',
  mp7:               'mp7',
  mp9:               'mp9',
  negev:             'negev',
  nova:              'nova',
  p2000:             'p2000',
  p250:              'p250',
  p90:               'p90',
  revolver:          'revolver',
  sawedoff:          'sawed-off',
  scar20:            'scar20',
  sg553:             'sg553',
  sg556:             'sg553',
  ssg08:             'ssg08',
  tec9:              'tec9',
  ump45:             'ump45',
  usp_silencer:      'usps',
  xm1014:            'xm1014',
  zeus:              'zeus',
  knife:             'knife',
  knife_t:           'knife',
  c4:                'bomb',
}

// Suomenkieliset nimet tooltipeihin
const WEAPON_FI: Record<string, string> = {
  ak47:'AK-47', aug:'AUG', awp:'AWP', bizon:'PP-Bizon', cz75a:'CZ75',
  deagle:'Deagle', decoy:'Decoy', famas:'FAMAS',
  fiveseven:'Five-7', g3sg1:'G3SG1', galil:'Galil', galilar:'Galil',
  glock:'Glock', hegrenade:'HE', flashbang:'Flash',
  incgrenade:'Molotov', molotov:'Molotov',
  smokegrenade:'Smoke', m249:'M249', m4a1:'M4A1', m4a1_silencer:'M4A1-S',
  m4a4:'M4A4', mac10:'MAC-10', mag7:'MAG-7', mp5sd:'MP5-SD', mp7:'MP7', mp9:'MP9',
  negev:'Negev', nova:'Nova', p2000:'P2000', p250:'P250', p90:'P90',
  revolver:'R8', sawedoff:'Sawed', scar20:'SCAR-20', sg553:'SG553',
  sg556:'SG553', ssg08:'SSG08', tec9:'Tec-9', ump45:'UMP-45',
  usp_silencer:'USP-S', xm1014:'XM1014', zeus:'Zeus', knife:'Veitsi',
  knife_t:'Veitsi', c4:'Pommi',
}

// Aseet jotka näytetään inventaariossa (ei veistä, ei c4)
const SKIP_INVENTORY = new Set(['knife', 'knife_t', 'c4'])

// Granaattityypit — näytetään eri järjestyksessä
const GRENADE_TYPES = new Set(['hegrenade','flashbang','smokegrenade','molotov','incgrenade','decoy'])

function weaponKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.replace('weapon_', '').toLowerCase()
}

function WeaponIcon({ weaponKey, size = 18 }: { weaponKey: string; size?: number }) {
  const iconName = WEAPON_ICON[weaponKey]
  if (!iconName) return null
  const title = WEAPON_FI[weaponKey] ?? weaponKey
  return (
    <img
      src={`/weapons/${iconName}-icon.svg`}
      alt={title}
      title={title}
      width={size}
      height={size}
      style={{ objectFit: 'contain', filter: 'invert(1) brightness(0.85) opacity(0.9)' }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

function hpColor(hp: number) {
  if (hp > 70) return '#22c55e'
  if (hp > 35) return '#f59e0b'
  return '#ef4444'
}

export default function PlayerList() {
  const { players } = useDemoStore()
  const { positions, currentTick } = usePlaybackStore()

  const curPos = Object.fromEntries(
    positions.filter(p => p.tick === currentTick).map(p => [String(p.steam_id), p])
  )

  const cts = players.filter(p => p.team_start === 'CT')
  const ts  = players.filter(p => p.team_start === 'T')

  const renderTeam = (team: typeof players, side: 'CT' | 'T') => {
    const color  = side === 'CT' ? '#5b9cf6' : '#f97316'
    const bgGlow = side === 'CT' ? 'rgba(91,156,246,0.06)' : 'rgba(249,115,22,0.06)'

    return (
      <div>
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'4px 10px', borderLeft:`2px solid ${color}`, flexShrink:0,
        }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:'.8px', color }}>{side === 'CT' ? 'CT' : 'T'}</span>
          <span style={{ fontSize:9, color:'#4b5563' }}>{team.length}</span>
        </div>
        <div style={{ padding:'0 6px 4px' }}>
          {team.map(player => {
            const pos    = curPos[player.steam_id]
            const alive  = pos?.is_alive !== false
            const hp     = pos?.health ?? 100
            const armor  = pos?.armor ?? 0
            const helmet = pos?.helmet ?? false
            const cash   = pos?.cash ?? 0

            // Inventaario suoraan arraysta
            const keys = (pos?.inventory ?? [])
              .map(weaponKey)
              .filter((k): k is string => k !== null && k !== '' && !SKIP_INVENTORY.has(k))

            // Erota pääaseet ja granaaatit
            const mainWeapons = keys.filter(k => !GRENADE_TYPES.has(k))
            const grenades    = keys.filter(k => GRENADE_TYPES.has(k))

            // Laske granaattimäärät
            const grenadeCounts = grenades.reduce<Record<string, number>>((acc, k) => {
              acc[k] = (acc[k] ?? 0) + 1
              return acc
            }, {})

            return (
              <div
                key={player.steam_id}
                style={{
                  background: alive ? bgGlow : 'transparent',
                  borderRadius: 6,
                  padding: '3px 6px',
                  marginBottom: 2,
                  opacity: alive ? 1 : 0.35,
                }}
              >
                {/* Rivi 1: Nimi + armor + HP + raha */}
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{
                    fontSize:10, fontWeight:600, color:'#e2e8f0',
                    flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }} title={player.name}>{player.name}</span>

                  {alive && armor > 0 && (
                    <img
                      src={helmet ? '/icons/armor-with-helmet-icon.svg' : '/icons/armor-icon.svg'}
                      width={9} height={9}
                      style={{ opacity:0.7, flexShrink:0 }}
                      title={helmet ? `Kypärä+kevlar ${armor}` : `Kevlar ${armor}`}
                    />
                  )}

                  <span style={{ fontSize:9, fontWeight:700, color: hpColor(hp), flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
                    {alive ? hp : '☠'}
                  </span>

                  {alive && (
                    <span style={{ fontSize:9, fontWeight:700, color:'#22c55e', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
                      ${Math.round(cash / 100) > 0 ? (cash / 1000).toFixed(1) + 'k' : cash}
                    </span>
                  )}
                </div>

                {/* HP bar */}
                <div style={{ height:2, background:'rgba(255,255,255,0.08)', borderRadius:1, margin:'2px 0' }}>
                  <div style={{ height:'100%', borderRadius:1, width:`${hp}%`, background:hpColor(hp), transition:'width .1s' }} />
                </div>

                {/* Rivi 2: Inventaario — kaikki yhdellä rivillä */}
                {alive && (mainWeapons.length > 0 || Object.keys(grenadeCounts).length > 0) && (
                  <div style={{ display:'flex', gap:2, flexWrap:'wrap' }}>
                    {mainWeapons.map((k, i) => {
                      const isActive = (pos?.active_weapon ?? '').replace('weapon_','').toLowerCase() === k
                      return (
                        <span key={i} style={{
                          fontSize:8, fontWeight:700,
                          padding:'1px 4px', borderRadius:4,
                          background: isActive ? color : `${color}20`,
                          color: isActive ? '#fff' : color,
                          border:`1px solid ${color}50`,
                          whiteSpace:'nowrap',
                        }}>
                          {WEAPON_FI[k] ?? k.replace(/_/g,' ')}
                        </span>
                      )
                    })}
                    {Object.entries(grenadeCounts).map(([k, count]) => (
                      <span key={k} style={{
                        fontSize:8, fontWeight:600,
                        padding:'1px 4px', borderRadius:4,
                        background:'rgba(156,163,175,0.12)',
                        color:'#9ca3af',
                        border:'1px solid rgba(156,163,175,0.25)',
                        whiteSpace:'nowrap',
                      }}>
                        {WEAPON_FI[k] ?? k}{count > 1 ? ` ×${count}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute',
      top: 10,
      left: 10,
      zIndex: 40,
      width: 200,
      background: 'rgba(13,15,20,0.92)',
      border: '1px solid #1e2130',
      borderRadius: 12,
      overflow: 'hidden',
      backdropFilter: 'blur(8px)',
      pointerEvents: 'none',
    }}>
      {renderTeam(cts, 'CT')}
      <div style={{ height:1, background:'#1e2130' }} />
      {renderTeam(ts, 'T')}
    </div>
  )
}