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

  const tickSet = new Set<number>(ticks)
  const addTick = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    tickSet.add(value)
  }
  ;(raw.kills ?? []).forEach((k: any) => addTick(k?.tick))
  ;(raw.damage ?? []).forEach((d: any) => addTick(d?.tick))
  ;(raw.shots ?? []).forEach((s: any) => addTick(s?.tick))
  ;(raw.flash ?? []).forEach((f: any) => addTick(f?.tick))
  ;(raw.bomb ?? []).forEach((b: any) => addTick(b?.tick))
  ;(raw.smokes ?? []).forEach((s: any) => { addTick(s?.start_tick); addTick(s?.end_tick) })
  ;(raw.grenades ?? []).forEach((g: any) => { addTick(g?.tick_thrown); addTick(g?.tick_detonated) })

  const mergedTicks = Array.from(tickSet).sort((a, b) => a - b)

  return {
    ticks: mergedTicks,
    positions,
    kills: raw.kills ?? [],
    grenades: raw.grenades ?? [],
    trajectories: raw.trajectories ?? [],
    smokes: raw.smokes ?? [],
    bomb: raw.bomb ?? [],
    flash: raw.flash ?? [],
    infernoFires: raw.infernoFires ?? [],
    shots: raw.shots ?? [],
    damage: raw.damage ?? []
  }
}

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  const { id, key, raw, startTick } = event.data
  const built = buildCachedRound(raw, startTick)
  const response: BuildResponse = { id, key, built }
  ;(self as DedicatedWorkerGlobalScope).postMessage(response)
}
