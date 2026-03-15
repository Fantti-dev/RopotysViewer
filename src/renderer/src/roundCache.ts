/**
 * Renderer-puolen kierrosdata-cache.
 * Data kulkee IPC:n yli vain kerran (preloadin aikana),
 * jonka jälkeen kierroksen vaihto on pelkkä Map-haku.
 */

import type { Position, Kill, Grenade, GrenadeTrajectoryPoint, SmokeEffect, BombEvent, FlashEvent, InfernoFirePoint, Shot, DamageEvent } from './types'

export interface RoundData {
  ticks:        number[]
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
}

// Module-tason Map — ei React-state, ei re-renderöintiä
const cache = new Map<string, RoundData>()

export function cacheKey(demoId: number, roundNum: number) {
  return `${demoId}_${roundNum}`
}

export function setCachedRound(demoId: number, roundNum: number, raw: any, startTick?: number) {
  // Leikkaa pois tikit ennen kierroksen virallista alkua (puukkokierros, lämmittely)
  const positions = startTick
    ? raw.positions.filter((p: any) => p.tick >= startTick)
    : raw.positions

  const ticks = [...new Set(positions.map((p: any) => p.tick) as number[])]
    .sort((a, b) => a - b)

  cache.set(cacheKey(demoId, roundNum), {
    ticks,
    positions,
    kills:        raw.kills,
    grenades:     raw.grenades,
    trajectories: raw.trajectories,
    smokes:       raw.smokes,
    bomb:         raw.bomb,
    flash:        raw.flash,
    infernoFires: raw.infernoFires,
    shots:        raw.shots,
    damage:       raw.damage ?? [],
  })
}

export function getCachedRound(demoId: number, roundNum: number): RoundData | undefined {
  return cache.get(cacheKey(demoId, roundNum))
}

export function hasCachedRound(demoId: number, roundNum: number): boolean {
  return cache.has(cacheKey(demoId, roundNum))
}

export function clearCache() {
  cache.clear()
}

export function cacheSize() {
  return cache.size
}