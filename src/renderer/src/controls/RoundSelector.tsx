import { useDemoStore, usePlaybackStore } from '../stores'

export async function loadRoundData(demoId: number, roundNum: number) {
  const [positions, kills, grenades, trajectories, smokes, bomb, flash, infernoFires, shots] = await Promise.all([
    window.electronAPI.getPositions(demoId, roundNum),
    window.electronAPI.getKills(demoId, roundNum),
    window.electronAPI.getGrenades(demoId, roundNum),
    window.electronAPI.getGrenadeTrajectories(demoId, roundNum),
    window.electronAPI.getSmokeEffects(demoId, roundNum),
    window.electronAPI.getBombEvents(demoId, roundNum),
    window.electronAPI.getFlashEvents(demoId, roundNum),
    window.electronAPI.getInfernoFires(demoId, roundNum),
    window.electronAPI.getShotsFired(demoId, roundNum),
  ])

  console.log(`[loadRoundData] round=${roundNum} pos=${positions.length} kills=${kills.length} grenades=${grenades.length} smokes=${smokes.length} bomb=${bomb.length} flash=${flash.length} traj=${trajectories.length} infernoFires=${infernoFires.length} shots=${shots.length}`)

  const ticks = [...new Set(positions.map((p: any) => p.tick))].sort((a: any, b: any) => a - b)
  const store = usePlaybackStore.getState()
  store.setAllTicks(ticks as number[])
  store.setPositions(positions)
  store.setKills(kills)
  store.setGrenades(grenades)
  store.setGrenadeTrajectories(trajectories)
  store.setSmokeEffects(smokes)
  store.setBombEvents(bomb)
  store.setFlashEvents(flash)
  store.setInfernoFires(infernoFires)
  store.setShots(shots)
  store.setPlaying(false)
}

export default function RoundSelector() {
  const { selectedDemo, rounds } = useDemoStore()
  const { currentRound, setRound } = usePlaybackStore()

  const handleClick = async (roundNum: number) => {
    if (!selectedDemo) return
    setRound(roundNum)
    await loadRoundData(selectedDemo.id, roundNum)
  }

  if (!selectedDemo) return <span className="text-xs text-gray-500">Valitse demo</span>

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs text-gray-400 mr-1">Round:</span>
      {rounds.map(r => (
        <button key={r.round_num} onClick={() => handleClick(r.round_num)}
          className={`w-7 h-6 text-xs rounded font-mono transition-colors ${
            currentRound === r.round_num
              ? 'bg-cs-accent text-black font-bold'
              : r.winner_team === 'CT'
                ? 'text-cs-ct hover:bg-cs-ct/20'
                : r.winner_team === 'T'
                  ? 'text-cs-t hover:bg-cs-t/20'
                  : 'text-gray-400 hover:bg-white/10'
          }`}
          title={`Round ${r.round_num}: ${r.winner_team ?? '?'} voitti (${r.win_reason ?? '?'})`}>
          {r.round_num}
        </button>
      ))}
      <span className="text-xs text-gray-500 ml-2">{selectedDemo.map_name}</span>
    </div>
  )
}