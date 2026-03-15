import { useDemoStore, usePlaybackStore } from '../stores'
import { getCachedRound, setCachedRound } from '../roundCache'

export const KNIFE_ROUND = -1  // varattu myöhempää käyttöä varten

let queuedRound: { demoId: number; roundNum: number } | null = null
let loadWorker: Promise<void> | null = null

async function loadRoundDataNow(demoId: number, roundNum: number) {
  const t0 = performance.now()
  const rounds = useDemoStore.getState().rounds

  const cached = getCachedRound(demoId, roundNum)
  if (cached) {
    applyRoundData(cached)
    return
  }

  const raw = await window.electronAPI.loadRoundAll(demoId, roundNum)
  const roundInfo = rounds.find(r => r.round_num === roundNum)
  setCachedRound(demoId, roundNum, raw, roundInfo?.start_tick)
  applyRoundData(getCachedRound(demoId, roundNum)!)

  if (process.env.NODE_ENV === 'development') {
    console.log(`[loadRound] round=${roundNum} ${(performance.now() - t0).toFixed(0)}ms`)
  }
}

export async function loadRoundData(demoId: number, roundNum: number) {
  queuedRound = { demoId, roundNum }

  if (loadWorker) {
    return loadWorker
  }

  loadWorker = (async () => {
    while (queuedRound) {
      const target = queuedRound
      queuedRound = null
      await loadRoundDataNow(target.demoId, target.roundNum)
    }
  })().finally(() => {
    loadWorker = null
  })

  return loadWorker
}

function applyRoundData(data: ReturnType<typeof getCachedRound>) {
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
  store.setPlaying(false)
}

export default function RoundSelector() {
  const { selectedDemo, rounds } = useDemoStore()
  const { currentRound, setRound } = usePlaybackStore()

  const handleClick = (roundNum: number) => {
    if (!selectedDemo) return
    usePlaybackStore.getState().setPlaying(false)
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
