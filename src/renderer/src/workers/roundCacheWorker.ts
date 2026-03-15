import type { RoundData } from '../roundCache'

type BuildRequest = {
  id: number
  key: string
  raw: any
  startTick?: number
}

type BuildResponse = {
  id: number
  key: string
  built: RoundData
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

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  const { id, key, raw, startTick } = event.data
  const built = buildCachedRound(raw, startTick)
  const response: BuildResponse = { id, key, built }
  ;(self as DedicatedWorkerGlobalScope).postMessage(response)
}
