import { create } from 'zustand'
import type { Demo, Round, Player, Position, Kill, Grenade, BombEvent, SmokeEffect, GrenadeTrajectoryPoint, FlashEvent, InfernoFirePoint, Shot, DamageEvent } from '../types'

// ── Demo store ─────────────────────────────────────────────────────────────────
interface DemoState {
  demos: Demo[]
  selectedDemo: Demo | null
  rounds: Round[]
  players: Player[]
  isLoading: boolean
  parseProgress: string[]
  preloadTotal: number
  preloadDone: number
  preloadActive: boolean
  setDemos: (d: Demo[]) => void
  setSelectedDemo: (d: Demo | null) => void
  setRounds: (r: Round[]) => void
  setPlayers: (p: Player[]) => void
  setLoading: (v: boolean) => void
  addParseProgress: (msg: string) => void
  clearParseProgress: () => void
  setPreload: (total: number, done: number, active: boolean) => void
  refreshDemos: () => Promise<void>
}

export const useDemoStore = create<DemoState>((set) => ({
  demos: [],
  selectedDemo: null,
  rounds: [],
  players: [],
  isLoading: false,
  parseProgress: [],
  preloadTotal: 0,
  preloadDone: 0,
  preloadActive: false,
  setDemos: (demos) => set({ demos }),
  setSelectedDemo: (selectedDemo) => set({ selectedDemo }),
  setRounds: (rounds) => set({ rounds }),
  setPlayers: (players) => set({ players }),
  setLoading: (isLoading) => set({ isLoading }),
  addParseProgress: (msg) => set((s) => ({ parseProgress: [...s.parseProgress.slice(-50), msg] })),
  clearParseProgress: () => set({ parseProgress: [] }),
  setPreload: (preloadTotal, preloadDone, preloadActive) => set({ preloadTotal, preloadDone, preloadActive }),
  refreshDemos: async () => {
    const demos = await window.electronAPI.getDemos()
    set({ demos })
  }
}))

// ── Playback store ─────────────────────────────────────────────────────────────
interface PlaybackState {
  currentRound: number
  currentTick: number
  tickProgress: number   // 0.0–1.0 sub-tick interpolation progress
  allTicks: number[]
  positions: Position[]
  kills: Kill[]
  grenades: Grenade[]
  grenadeTrajectories: GrenadeTrajectoryPoint[]
  smokeEffects: SmokeEffect[]
  bombEvents: BombEvent[]
  flashEvents: FlashEvent[]
  infernoFires: InfernoFirePoint[]
  shots: Shot[]
  damage: DamageEvent[]
  isPlaying: boolean
  playbackSpeed: number
  setRound: (round: number) => void
  setTick: (tick: number) => void
  setAllTicks: (ticks: number[]) => void
  setPositions: (p: Position[]) => void
  setKills: (k: Kill[]) => void
  setGrenades: (g: Grenade[]) => void
  setGrenadeTrajectories: (t: GrenadeTrajectoryPoint[]) => void
  setSmokeEffects: (s: SmokeEffect[]) => void
  setBombEvents: (b: BombEvent[]) => void
  setFlashEvents: (f: FlashEvent[]) => void
  setInfernoFires: (i: InfernoFirePoint[]) => void
  setShots: (s: Shot[]) => void
  setDamage: (d: DamageEvent[]) => void
  setPlaying: (v: boolean) => void
  setSpeed: (s: number) => void
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentRound: 0,
  currentTick: 0,
  tickProgress: 0,
  allTicks: [],
  positions: [],
  kills: [],
  grenades: [],
  grenadeTrajectories: [],
  smokeEffects: [],
  bombEvents: [],
  flashEvents: [],
  infernoFires: [],
  shots: [],
  damage: [],
  isPlaying: false,
  playbackSpeed: 1,

  setRound:              (currentRound)          => set({ currentRound, isPlaying: false }),
  setTick:               (currentTick)           => set({ currentTick }),
  setAllTicks:           (allTicks)              => set({ allTicks, currentTick: allTicks[0] ?? 0 }),
  setPositions:          (positions)             => set({ positions }),
  setKills:              (kills)                 => set({ kills }),
  setGrenades:           (grenades)              => set({ grenades }),
  setGrenadeTrajectories:(grenadeTrajectories)   => set({ grenadeTrajectories }),
  setSmokeEffects:       (smokeEffects)          => set({ smokeEffects }),
  setBombEvents:         (bombEvents)            => set({ bombEvents }),
  setFlashEvents:        (flashEvents)           => set({ flashEvents }),
  setInfernoFires:       (infernoFires)          => set({ infernoFires }),
  setShots:              (shots)                 => set({ shots }),
  setDamage:             (damage)               => set({ damage }),
  setPlaying:            (isPlaying)             => set({ isPlaying }),
  setSpeed:              (playbackSpeed)         => set({ playbackSpeed }),
}))

// ── Layer store ────────────────────────────────────────────────────────────────
interface LayerState {
  players: boolean
  playerTrails: boolean
  playerLabels: boolean
  kills: boolean
  killLines: boolean
  grenades: boolean
  smokes: boolean
  bomb: boolean
  shots: boolean
  heatmap: boolean
  lowerLayer: boolean
  toggle: (layer: keyof Omit<LayerState, 'toggle' | 'set'>) => void
  set: (layer: keyof Omit<LayerState, 'toggle' | 'set'>, value: boolean) => void
}

export const useLayerStore = create<LayerState>((setState) => ({
  players:      true,
  playerTrails: true,
  playerLabels: true,
  kills:        true,
  killLines:    false,
  grenades:     true,
  smokes:       true,
  bomb:         true,
  shots:        false,
  heatmap:      false,
  lowerLayer:   false,
  toggle: (layer) => setState((s) => ({ [layer]: !s[layer] } as any)),
  set:    (layer, value) => setState({ [layer]: value } as any),
}))

// ── Valittu pelaaja — POV-seuranta ────────────────────────────────────────────
interface SelectedPlayerState {
  steamId: string | null
  setSteamId: (id: string | null) => void
}
export const useSelectedPlayerStore = create<SelectedPlayerState>((set) => ({
  steamId: null,
  setSteamId: (steamId) => set({ steamId }),
}))