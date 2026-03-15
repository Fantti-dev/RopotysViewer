/**
 * Renderer-puolen kierrosdata-cache.
 * Data kulkee IPC:n yli vain tarvittaessa ensimmäisellä kierrosavauksella,
 * jonka jälkeen kierroksen vaihto on pelkkä Map-haku.
 */

import type {
  Position,
  Kill,
  Grenade,
  GrenadeTrajectoryPoint,
  SmokeEffect,
  BombEvent,
  FlashEvent,
  InfernoFirePoint,
  Shot,
  DamageEvent
} from './types'

export interface RoundData {
  ticks: number[]
  positions: Position[]
  kills: Kill[]
  grenades: Grenade[]
  trajectories: GrenadeTrajectoryPoint[]
  smokes: SmokeEffect[]
  bomb: BombEvent[]
  flash: FlashEvent[]
  infernoFires: InfernoFirePoint[]
  shots: Shot[]
  damage: DamageEvent[]
}

type BackgroundBuildResult = {
  id: number
  key: string
  built: RoundData
}

type PendingBuild = {
  resolve: () => void
  reject: (error: unknown) => void
}

// Module-tason Map — ei React-state, ei re-renderöintiä
const cache = new Map<string, RoundData>()
let worker: Worker | null = null
let requestId = 0
const pending = new Map<number, PendingBuild>()

export function cacheKey(demoId: number, roundNum: number, variant = 'default') {
  return `${demoId}_${roundNum}_${variant}`
}

function buildCachedRound(raw: any, startTick?: number): RoundData {
  const allPositions = raw.positions ?? []

  let positions = allPositions
  if (startTick !== undefined && startTick !== null && allPositions.length > 0) {
    let startIndex = 0
    while (startIndex < allPositions.length && allPositions[startIndex].tick < startTick) {
      startIndex++
    }
    positions = startIndex > 0 ? allPositions.slice(startIndex) : allPositions
  }

  const ticks: number[] = []
  let isNonDecreasing = true
  let previousTick = Number.NEGATIVE_INFINITY
  for (const p of positions) {
    const tick = p.tick as number
    if (tick < previousTick) {
      isNonDecreasing = false
      break
    }
    previousTick = tick
  }

  if (isNonDecreasing) {
    let lastTick = Number.NaN
    for (const p of positions) {
      const tick = p.tick as number
      if (tick !== lastTick) {
        ticks.push(tick)
        lastTick = tick
      }
    }
  } else {
    ticks.push(...new Set(positions.map((p: any) => p.tick) as number[]).values())
    ticks.sort((a, b) => a - b)
  }

  return {
    ticks,
    positions,
    kills: raw.kills,
    grenades: raw.grenades,
    trajectories: raw.trajectories,
    smokes: raw.smokes,
    bomb: raw.bomb,
    flash: raw.flash,
    infernoFires: raw.infernoFires,
    shots: raw.shots,
    damage: raw.damage ?? []
  }
}

function ensureWorker() {
  if (worker) return worker

  worker = new Worker(new URL('./workers/roundCacheWorker.ts', import.meta.url), { type: 'module' })

  worker.onmessage = (event: MessageEvent<BackgroundBuildResult>) => {
    const { id, key, built } = event.data

    if (!cache.has(key)) {
      cache.set(key, built)
    }

    const pendingBuild = pending.get(id)
    if (pendingBuild) {
      pending.delete(id)
      pendingBuild.resolve()
    }
  }

  worker.onerror = (error) => {
    for (const [id, pendingBuild] of pending) {
      pending.delete(id)
      pendingBuild.reject(error)
    }
  }

  return worker
}

export function setCachedRound(demoId: number, roundNum: number, raw: any, startTick?: number, variant = 'default') {
  cache.set(cacheKey(demoId, roundNum, variant), buildCachedRound(raw, startTick))
}

export function setCachedRoundBackground(
  demoId: number,
  roundNum: number,
  raw: any,
  startTick?: number,
  variant = 'default'
): Promise<void> {
  const key = cacheKey(demoId, roundNum, variant)
  if (cache.has(key)) {
    return Promise.resolve()
  }

  try {
    const activeWorker = ensureWorker()
    const id = ++requestId

    return new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      activeWorker.postMessage({ id, key, raw, startTick })
    })
  } catch {
    // Fallback if Worker is unavailable for any reason.
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!cache.has(key)) {
          cache.set(key, buildCachedRound(raw, startTick))
        }
        resolve()
      }, 0)
    })
  }
}

export function getCachedRound(demoId: number, roundNum: number, variant = 'default'): RoundData | undefined {
  return cache.get(cacheKey(demoId, roundNum, variant))
}

export function hasCachedRound(demoId: number, roundNum: number, variant = 'default'): boolean {
  return cache.has(cacheKey(demoId, roundNum, variant))
}

export function clearCache() {
  cache.clear()
}

export function cacheSize() {
  return cache.size
}
