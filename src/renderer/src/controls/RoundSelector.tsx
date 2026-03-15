import { useDemoStore, usePlaybackStore, useLayerStore } from '../stores'
import { getCachedRound, setCachedRound, setCachedRoundBackground } from '../roundCache'

export const KNIFE_ROUND = -1  // varattu myöhempää käyttöä varten

let activeRequestId = 0
let preloadSessionId = 0


function getRoundLoadOptions() {
  const layers = useLayerStore.getState()
  return {
    includeKills: layers.kills || layers.killLines,
    includeSmokes: layers.smokes,
    includeBomb: layers.bomb,
    includeShots: layers.shots,
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
}

const FULL_PRELOAD_VARIANT = optionsVariant(FULL_PRELOAD_OPTIONS)


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
      const raw = await window.electronAPI.loadRoundAll(demoId, roundNum, FULL_PRELOAD_OPTIONS)
      if (sessionId !== preloadSessionId) return

      const roundInfo = rounds.find(r => r.round_num === roundNum)
      setCachedRoundBackground(demoId, roundNum, raw, roundInfo?.start_tick, FULL_PRELOAD_VARIANT).catch(() => {})
    } catch {
      // Silent preload: ignore per-round failures, on-demand loading still works.
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
      const raw = await window.electronAPI.loadRoundAll(demoId, roundNum, options)
      const roundInfo = rounds.find(r => r.round_num === roundNum)
      await setCachedRoundBackground(demoId, roundNum, raw, roundInfo?.start_tick, variant)
    } catch {
      // Best-effort prewarm only.
    }
  }
}

export async function loadRoundData(demoId: number, roundNum: number) {
  const requestId = ++activeRequestId
  const wasPlaying = usePlaybackStore.getState().isPlaying

  const rounds = useDemoStore.getState().rounds
  const options = getRoundLoadOptions()
  const variant = optionsVariant(options)
  const cached = getCachedRound(demoId, roundNum, variant)
  if (cached) {
    applyRoundData(cached, wasPlaying)
    return
  }

  const raw = await window.electronAPI.loadRoundAll(demoId, roundNum, options)

  if (requestId !== activeRequestId) {
    return
  }

  const roundInfo = rounds.find(r => r.round_num === roundNum)
  setCachedRound(demoId, roundNum, raw, roundInfo?.start_tick, variant)
  applyRoundData(getCachedRound(demoId, roundNum, variant)!, wasPlaying)
}

function applyRoundData(data: ReturnType<typeof getCachedRound>, keepPlaying: boolean) {
  if (!data) return
  const store = usePlaybackStore.getState()
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
