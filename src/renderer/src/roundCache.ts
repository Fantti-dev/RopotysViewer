/**
 * Renderer-puolen kierrosdata-cache.
 * Data kulkee IPC:n yli vain tarvittaessa ensimmäisellä kierrosavauksella,
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
let backgroundWriteQueue: Promise<void> = Promise.resolve()
const BACKGROUND_CHUNK_SIZE = 500

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
    kills:        raw.kills,
    grenades:     raw.grenades,
    trajectories: raw.trajectories,
    smokes:       raw.smokes,
    bomb:         raw.bomb,
    flash:        raw.flash,
    infernoFires: raw.infernoFires,
    shots:        raw.shots,
    damage:       raw.damage ?? [],
  }
}


async function yieldToEventLoop() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function buildCachedRoundAsync(raw: any, startTick?: number): Promise<RoundData> {
  const allPositions = raw.positions ?? []

  let startIndex = 0
  if (startTick !== undefined && startTick !== null && allPositions.length > 0) {
    while (startIndex < allPositions.length && allPositions[startIndex].tick < startTick) {
      startIndex++
      if (startIndex % BACKGROUND_CHUNK_SIZE === 0) {
        await yieldToEventLoop()
      }
    }
  }

  const positions = startIndex > 0 ? allPositions.slice(startIndex) : allPositions

  const ticks: number[] = []
  let isNonDecreasing = true
  let previousTick = Number.NEGATIVE_INFINITY

  for (let i = 0; i < positions.length; i++) {
    const tick = positions[i].tick as number
    if (tick < previousTick) {
      isNonDecreasing = false
      break
    }
    previousTick = tick

    if (i % BACKGROUND_CHUNK_SIZE === 0 && i > 0) {
      await yieldToEventLoop()
    }
  }

  if (isNonDecreasing) {
    let lastTick = Number.NaN
    for (let i = 0; i < positions.length; i++) {
      const tick = positions[i].tick as number
      if (tick !== lastTick) {
        ticks.push(tick)
        lastTick = tick
      }

      if (i % BACKGROUND_CHUNK_SIZE === 0 && i > 0) {
        await yieldToEventLoop()
      }
    }
  } else {
    const tickSet = new Set<number>()
    for (let i = 0; i < positions.length; i++) {
      tickSet.add(positions[i].tick as number)
      if (i % BACKGROUND_CHUNK_SIZE === 0 && i > 0) {
        await yieldToEventLoop()
      }
    }
    ticks.push(...tickSet.values())
    ticks.sort((a, b) => a - b)
  }

  return {
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
  }
}

function scheduleBackgroundWrite(fn: () => void): Promise<void> {
  return new Promise((resolve) => {
    const run = () => {
      fn()
      resolve()
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => run(), { timeout: 200 })
      return
    }

    setTimeout(run, 0)
  })
}

export function setCachedRound(demoId: number, roundNum: number, raw: any, startTick?: number, variant = "default") {
  cache.set(cacheKey(demoId, roundNum, variant), buildCachedRound(raw, startTick))
}

export function setCachedRoundBackground(demoId: number, roundNum: number, raw: any, startTick?: number, variant = "default") {
  const key = cacheKey(demoId, roundNum, variant)
  backgroundWriteQueue = backgroundWriteQueue.then(async () => {
    if (cache.has(key)) return

    const built = await buildCachedRoundAsync(raw, startTick)

    await scheduleBackgroundWrite(() => {
      if (!cache.has(key)) {
        cache.set(key, built)
      }
    })
  })
  return backgroundWriteQueue
}

export function getCachedRound(demoId: number, roundNum: number, variant = "default"): RoundData | undefined {
  return cache.get(cacheKey(demoId, roundNum, variant))
}

export function hasCachedRound(demoId: number, roundNum: number, variant = "default"): boolean {
  return cache.has(cacheKey(demoId, roundNum, variant))
}

export function clearCache() {
  cache.clear()
}

export function cacheSize() {
  return cache.size
}