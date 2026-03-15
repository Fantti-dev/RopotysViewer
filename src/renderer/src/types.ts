// ── Electron IPC API tyyppi (käytettävissä kaikkialla rendererissä) ──────────
declare global {
  interface Window {
    electronAPI: {
      openDemoDialog: () => Promise<string[] | null>
      parseDemo: (demPath: string) => Promise<{ success: boolean; output: string }>
      onParserProgress: (cb: (msg: string) => void) => () => void

      getDemos: () => Promise<Demo[]>
      getDemoById: (demoId: number) => Promise<Demo | null>
      deleteDemo: (demoId: number) => Promise<{ success: boolean }>

      getRounds: (demoId: number) => Promise<Round[]>
      getPlayers: (demoId: number) => Promise<Player[]>
      getPositions: (demoId: number, roundNum: number) => Promise<Position[]>
      getKills: (demoId: number, roundNum: number) => Promise<Kill[]>
      getDamage: (demoId: number, roundNum: number) => Promise<DamageEvent[]>
      getGrenades: (demoId: number, roundNum: number) => Promise<Grenade[]>
      getGrenadeTrajectories: (demoId: number, roundNum: number) => Promise<GrenadeTrajectoryPoint[]>
      getInfernoFires: (demoId: number, roundNum: number) => Promise<InfernoFirePoint[]>
      getSmokeEffects: (demoId: number, roundNum: number) => Promise<SmokeEffect[]>
      getBombEvents: (demoId: number, roundNum: number) => Promise<BombEvent[]>
      getShotsFired: (demoId: number, roundNum: number) => Promise<Shot[]>
      loadRoundAll:  (demoId: number, roundNum: number, options?: { includeKills?: boolean; includeSmokes?: boolean; includeBomb?: boolean; includeShots?: boolean; includeGrenades?: boolean; includeTrajectories?: boolean }) => Promise<{
        positions:    Position[]
        kills:        Kill[]
        grenades:     Grenade[]
        trajectories: GrenadeTrajectoryPoint[]
        smokes:       SmokeEffect[]
        bomb:         BombEvent[]
        flash:        FlashEvent[]
        infernoFires: InfernoFirePoint[]
        shots:        Shot[]
        damage:       DamageEvent[]
      }>
      getCumulativeStats: (demoId: number, upToRound: number) => Promise<{ kills: any[]; damage: any[]; flash: any[] }>
      getFlashEvents: (demoId: number, roundNum: number) => Promise<FlashEvent[]>
      getHeatmapPositions: (demoId: number, steamId?: string) => Promise<HeatmapPoint[]>
      debugLog: (event: string, payload?: unknown) => Promise<{ ok: boolean }>
      getDebugLogPath: () => Promise<string>

      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      getMapsPath: () => Promise<string>
    }
  }
}

// ── Data-mallit ───────────────────────────────────────────────────────────────
export interface Demo {
  id: number
  filename: string
  map_name: string
  tickrate: number
  match_id: string | null
  parsed_at: string
  round_count: number
  player_count: number
}

export interface Round {
  id: number
  demo_id: number
  round_num: number
  winner_team: 'CT' | 'T'
  win_reason: 'elimination' | 'bomb_exploded' | 'bomb_defused' | 'time'
  round_type: 'pistol' | 'eco' | 'force' | 'full' | 'unknown'
  t_score: number
  ct_score: number
  kill_count: number
  start_tick: number
  is_knife: boolean
}

export interface Player {
  id: number
  demo_id: number
  steam_id: string
  name: string
  team_start: 'CT' | 'T'
}

export interface Position {
  tick: number
  steam_id: string
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  velocity_x: number
  velocity_y: number
  velocity_z: number
  is_alive: boolean
  is_ducking: boolean
  is_scoped: boolean
  is_airborne: boolean
  is_blinded: boolean
  health: number
  armor: number
  helmet: boolean
  active_weapon: string
  equip_value: number
  cash: number
  cash_spend_this_round: number
  inventory: string[]
}

export interface Kill {
  id: number
  demo_id: number
  round_num: number
  tick: number
  attacker_steam_id: string
  victim_steam_id: string
  assister_steam_id: string | null
  weapon: string
  headshot: boolean
  wallbang: boolean
  noscope: boolean
  thrusmoke: boolean
  blind: boolean
  attacker_x: number
  attacker_y: number
  victim_x: number
  victim_y: number
  attacker_name: string
  victim_name: string
  assister_name: string | null
}

export interface DamageEvent {
  id: number
  demo_id: number
  round_num: number
  tick: number
  attacker_steam_id: string
  victim_steam_id: string
  weapon: string
  damage: number
  hitgroup: string
  armor_damage: number
  health_after: number
  attacker_name: string
  victim_name: string
}

export type GrenadeType = 'smokegrenade' | 'flashbang' | 'hegrenade' | 'molotov' | 'incgrenade' | 'decoy'

export interface Grenade {
  id: number
  demo_id: number
  round_num: number
  tick_thrown: number
  tick_detonated: number | null
  thrower_steam_id: string | null
  grenade_type: GrenadeType
  throw_x: number
  throw_y: number
  throw_z: number
  detonate_x: number | null
  detonate_y: number | null
  detonate_z: number | null
  thrower_name: string | null
}

export interface GrenadeTrajectoryPoint {
  id: number
  grenade_id: number
  tick: number
  x: number
  y: number
  z: number
}

export interface SmokeEffect {
  id: number
  grenade_id: number
  start_tick: number
  end_tick: number
  x: number
  y: number
  z: number
  radius: number
}

export interface BombEvent {
  id: number
  demo_id: number
  round_num: number
  event_type: 'plant' | 'defuse' | 'explode' | 'defuse_start' | 'defuse_abort'
  tick: number
  player_steam_id: string
  site: 'A' | 'B' | null
  x: number
  y: number
  player_name: string
}

export interface Shot {
  id: number
  demo_id: number
  round_num: number
  tick: number
  steam_id: string
  weapon: string
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  player_name: string
}

export interface HeatmapPoint {
  x: number
  y: number
  weight: number
}

export interface FlashEvent {
  id: number
  demo_id: number
  round_num: number
  tick: number
  thrower_steam_id: string | null
  blinded_steam_id: string
  flash_duration: number
  match_quality?: string | null
  thrower_name: string | null
  blinded_name: string | null
}

// ── Karttakonfiguraatio ───────────────────────────────────────────────────────
export interface InfernoFirePoint {
  grenade_id: number
  tick: number
  x: number
  y: number
}

export interface MapConfig {
  // Koordinaattimuunnos: pixel = (world - offset) / scale
  pos_x: number          // world X joka vastaa vasenta reunaa
  pos_y: number          // world Y joka vastaa yläreunaa
  scale: number          // kuinka monta world-yksikköä per pikseli
  // Kaksikerroksiset kartat (nuke, vertigo)
  has_lower: boolean
  z_threshold?: number   // Z jonka alapuolella näytetään lower-layer
  lower_offset_x?: number
  lower_offset_y?: number
  lower_scale?: number
  // Tiedostonimet (ilman .png)
  image: string          // esim. "de_mirage"
  image_lower?: string   // esim. "de_nuke_lower"
}
