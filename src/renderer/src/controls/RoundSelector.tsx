import { useDemoStore, usePlaybackStore, useLayerStore } from '../stores'
import { getCachedRound, setCachedRound, setCachedRoundBackground } from '../roundCache'

export const KNIFE_ROUND = -1  // varattu myöhempää käyttöä varten

let activeRequestId = 0
let preloadSessionId = 0
const inFlightRoundLoads = new Map<string, Promise<any>>()


function getRoundLoadOptions() {
  const layers = useLayerStore.getState()
  return {
    includeKills: layers.kills || layers.killLines,
    includeSmokes: layers.smokes,
    includeBomb: layers.bomb,
    includeShots: layers.shots,
    includeGrenades: layers.grenades || layers.smokes,
    includeTrajectories: layers.grenades || layers.smokes,
  }
}

function optionsVariant(options: ReturnType<typeof getRoundLoadOptions>) {
  return `${options.includeKills ? 1 : 0}${options.includeSmokes ? 1 : 0}${options.includeBomb ? 1 : 0}${options.includeShots ? 1 : 0}`
}

const FULL_PRELOAD_OPTIONS = {
  includeKills: false,
  includeSmokes: false,
  includeBomb: false,
  includeShots: false,
  includeGrenades: false,
  includeTrajectories: false,
}

const FULL_PRELOAD_VARIANT = optionsVariant(FULL_PRELOAD_OPTIONS)

function loadKey(demoId: number, roundNum: number, variant: string) {
  return `${demoId}:${roundNum}:${variant}`
}

function loadRoundAllDedup(
  demoId: number,
  roundNum: number,
  options: { includeKills?: boolean; includeSmokes?: boolean; includeBomb?: boolean; includeShots?: boolean; includeGrenades?: boolean; includeTrajectories?: boolean },
  variant: string
) {
  const key = loadKey(demoId, roundNum, variant)
  const existing = inFlightRoundLoads.get(key)
  if (existing) return existing

  const req = window.electronAPI.loadRoundAll(demoId, roundNum, options)
  inFlightRoundLoads.set(key, req)
  req.finally(() => {
    if (inFlightRoundLoads.get(key) === req) {
      inFlightRoundLoads.delete(key)
    }
  })
  return req
}


function setRoundPreloadState(total: number, done: number, active: boolean) {
  const setter = (useDemoStore.getState() as any).setRoundPreload
  if (typeof setter === 'function') {
    setter(total, done, active)
  }
}


async function waitPreloadSlot() {
  // While playback is active, pace background preloads to reduce CPU/IO bursts.
  const isPlaying = usePlaybackStore.getState().isPlaying
  if (isPlaying) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export function stopRoundPreload() {
  preloadSessionId++
  setRoundPreloadState(0, 0, false)
}

export async function preloadRoundsSilently(demoId: number, roundNums: number[], skipRound?: number) {
  const sessionId = ++preloadSessionId
  const rounds = useDemoStore.getState().rounds
  const targets = roundNums.filter((roundNum) => roundNum !== skipRound)
  const total = targets.length
  let done = 0

  setRoundPreloadState(total, 0, total > 0)

  for (const roundNum of targets) {
    const startedAt = performance.now()
    if (sessionId !== preloadSessionId) return

    await waitPreloadSlot()
    if (sessionId !== preloadSessionId) return

    if (getCachedRound(demoId, roundNum, FULL_PRELOAD_VARIANT)) {
      done++
      setRoundPreloadState(total, done, done < total)
      continue
    }

    try {
      // Fetch can run in background even during playback.
      const raw = await loadRoundAllDedup(demoId, roundNum, FULL_PRELOAD_OPTIONS, FULL_PRELOAD_VARIANT)
      if (sessionId !== preloadSessionId) return

      const roundInfo = rounds.find(r => r.round_num === roundNum)
      setCachedRoundBackground(demoId, roundNum, raw, roundInfo?.start_tick, FULL_PRELOAD_VARIANT).catch(() => {})
      window.electronAPI.debugLog('round.preload.silent.done', {
        demoId,
        roundNum,
        durationMs: Math.round(performance.now() - startedAt),
      }).catch(() => {})
    } catch {
      // Silent preload: ignore per-round failures, on-demand loading still works.
      window.electronAPI.debugLog('round.preload.silent.error', { demoId, roundNum }).catch(() => {})
    }

    done++
    setRoundPreloadState(total, done, done < total)

    // Adaptive pacing also after each completed preload round.
    await waitPreloadSlot()
  }
}

export async function prewarmRoundsForInstantOpen(demoId: number, roundNums: number[]) {
  const rounds = useDemoStore.getState().rounds
  const options = getRoundLoadOptions()
  const variant = optionsVariant(options)

  for (const roundNum of roundNums) {
    if (getCachedRound(demoId, roundNum, variant)) continue

    try {
      const startedAt = performance.now()
      const raw = await loadRoundAllDedup(demoId, roundNum, options, variant)
      const roundInfo = rounds.find(r => r.round_num === roundNum)
      await setCachedRoundBackground(demoId, roundNum, raw, roundInfo?.start_tick, variant)
      window.electronAPI.debugLog('round.prewarm.done', {
        demoId,
        roundNum,
        durationMs: Math.round(performance.now() - startedAt),
      }).catch(() => {})
    } catch {
      // Best-effort prewarm only.
      window.electronAPI.debugLog('round.prewarm.error', { demoId, roundNum }).catch(() => {})
    }
  }
}

export async function loadRoundData(demoId: number, roundNum: number) {
  const startedAt = performance.now()
  const requestId = ++activeRequestId
  const wasPlaying = usePlaybackStore.getState().isPlaying

  const rounds = useDemoStore.getState().rounds
  const options = getRoundLoadOptions()
  const variant = optionsVariant(options)
  const cached = getCachedRound(demoId, roundNum, variant)
  if (cached) {
    applyRoundData(cached, wasPlaying, roundNum)
    window.electronAPI.debugLog('round.load.renderer.cache_hit', {
      demoId,
      roundNum,
      variant,
      wasPlaying,
      durationMs: Math.round(performance.now() - startedAt),
    }).catch(() => {})
    return
  }

  const raw = await loadRoundAllDedup(demoId, roundNum, options, variant)

  if (requestId !== activeRequestId) {
    return
  }

  const roundInfo = rounds.find(r => r.round_num === roundNum)
  setCachedRound(demoId, roundNum, raw, roundInfo?.start_tick, variant)
  applyRoundData(getCachedRound(demoId, roundNum, variant)!, wasPlaying, roundNum)
  window.electronAPI.debugLog('round.load.renderer.fetch', {
    demoId,
    roundNum,
    variant,
    wasPlaying,
    durationMs: Math.round(performance.now() - startedAt),
  }).catch(() => {})
}

function applyRoundData(data: ReturnType<typeof getCachedRound>, keepPlaying: boolean, roundNum: number) {
  if (!data) return
  const store = usePlaybackStore.getState()
  const demoStore = useDemoStore.getState()
  const firstTick = data.ticks[0]
  const lastTick = data.ticks[data.ticks.length - 1]

  store.setAllTicks(data.ticks)
  store.setPositions(data.positions)
  store.setKills(data.kills)
  store.setGrenades(data.grenades)
  store.setGrenadeTrajectories(data.trajectories)
  store.setSmokeEffects(data.smokes)
  store.setBombEvents(data.bomb)
  store.setFlashEvents(data.flash)
  store.setInfernoFires(data.infernoFires)
  store.setShots(data.shots)
  store.setDamage(data.damage)

  if (typeof firstTick === 'number' && typeof lastTick === 'number') {
    const currentTick = store.currentTick
    const clamped = Math.max(firstTick, Math.min(lastTick, currentTick))
    // Ensure round switch never leaves stale tick from previous round.
    // If previous tick is out of range, snap to round start.
    store.setTick(clamped)
  }

  // Diagnostics: compare damage at tactical round-end condition vs final playback tick.
  const roundInfo = demoStore.rounds.find((r) => r.round_num === roundNum)
  const killEndTick = data.kills.length ? data.kills[data.kills.length - 1].tick : undefined
  const bombDetonateTick = data.bomb.find((b) => b.event_type === 'explode')?.tick
  const bombDefuseTick = data.bomb.find((b) => b.event_type === 'defuse')?.tick
  const candidates = [killEndTick, bombDetonateTick, bombDefuseTick].filter((v): v is number => typeof v === 'number')
  const conditionTick = candidates.length > 0 ? Math.max(...candidates) : (typeof lastTick === 'number' ? lastTick : 0)
  const finalTick = typeof lastTick === 'number' ? lastTick : conditionTick

  const teamBySteam = new Map<string, string>()
  demoStore.players.forEach((p) => teamBySteam.set(String(p.steam_id), p.team_start))

  const byPlayer = new Map<string, { atCondition: number; atFinal: number }>()
  for (const dmg of data.damage) {
    const attacker = String(dmg.attacker_steam_id ?? '')
    const victim = String(dmg.victim_steam_id ?? '')
    if (!attacker) continue
    const attackerTeam = teamBySteam.get(attacker)
    const victimTeam = teamBySteam.get(victim)
    if (attackerTeam && victimTeam && attackerTeam === victimTeam) continue

    const row = byPlayer.get(attacker) ?? { atCondition: 0, atFinal: 0 }
    if (typeof dmg.tick === 'number' && dmg.tick <= conditionTick) row.atCondition += dmg.damage ?? 0
    if (typeof dmg.tick === 'number' && dmg.tick <= finalTick) row.atFinal += dmg.damage ?? 0
    byPlayer.set(attacker, row)
  }

  const damageByPlayer = Array.from(byPlayer.entries()).map(([steamId, totals]) => ({
    steamId,
    name: demoStore.players.find((p) => String(p.steam_id) === steamId)?.name ?? steamId,
    atCondition: totals.atCondition,
    atFinal: totals.atFinal,
    deltaAfterCondition: totals.atFinal - totals.atCondition,
  }))

  window.electronAPI.debugLog('round.damage.cutoff.compare', {
    demoId: demoStore.selectedDemo?.id,
    roundNum,
    winReason: roundInfo?.win_reason,
    conditionTick,
    finalTick,
    damageByPlayer,
  }).catch(() => {})

  store.setPlaying(keepPlaying)
}

export default function RoundSelector() {
  const { selectedDemo, rounds } = useDemoStore()
  const { currentRound, setRound } = usePlaybackStore()

  const handleClick = (roundNum: number) => {
    if (!selectedDemo) return
    setRound(roundNum)
    loadRoundData(selectedDemo.id, roundNum)
  }

  if (!selectedDemo) return null

  const half1   = rounds.filter(r => !r.is_knife && r.round_num <= 12)
  const half2   = rounds.filter(r => !r.is_knife && r.round_num >= 13 && r.round_num <= 24)
  const ot      = rounds.filter(r => !r.is_knife && r.round_num >= 25)
  const knifes  = rounds.filter(r => r.is_knife)

  const RBtn = ({ r }: { r: typeof rounds[0] }) => {
    const active   = currentRound === r.round_num
    const won      = r.winner_team
    const isKnife  = r.is_knife
    return (
      <button
        key={r.round_num}
        onClick={() => handleClick(r.round_num)}
        title={isKnife ? `Erä ${r.round_num}: Puukkokierros 🔪` : `Erä ${r.round_num}: ${won ?? '?'} voitti`}
        style={{
          width:26, height:26, borderRadius:8,
          fontSize: isKnife ? 13 : 11, fontWeight: active ? 700 : 500,
          cursor:'pointer', transition:'all .12s',
          transform: active ? 'scale(1.1)' : 'scale(1)',
          background: active    ? '#f97316'
            : isKnife           ? 'rgba(251,191,36,0.12)'
            : won === 'CT'      ? 'rgba(91,156,246,0.15)'
            : won === 'T'       ? 'rgba(249,115,22,0.15)'
            : 'rgba(255,255,255,0.04)',
          color: active         ? '#fff'
            : isKnife           ? '#fbbf24'
            : won === 'CT'      ? '#5b9cf6'
            : won === 'T'       ? '#f97316'
            : '#6b7280',
          border: active        ? '1px solid #f97316'
            : isKnife           ? '1px solid rgba(251,191,36,0.3)'
            : won === 'CT'      ? '1px solid rgba(91,156,246,0.25)'
            : won === 'T'       ? '1px solid rgba(249,115,22,0.25)'
            : '1px solid transparent',
        }}
      >
        {isKnife ? '🔪' : r.round_num}
      </button>
    )
  }

  return (
    <div style={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap' }}>
      {knifes.length > 0 && <>
        {knifes.map(r => <RBtn key={r.round_num} r={r} />)}
        <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
      </>}
      {half1.map(r => <RBtn key={r.round_num} r={r} />)}
      {half2.length > 0 && <>
        <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
        {half2.map(r => <RBtn key={r.round_num} r={r} />)}
      </>}
      {ot.length > 0 && <>
        <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
        {ot.map(r => <RBtn key={r.round_num} r={r} />)}
      </>}
    </div>
  )
}
