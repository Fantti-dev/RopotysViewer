import { useDemoStore, usePlaybackStore } from '../stores'
import { loadRoundData } from '../controls/RoundSelector'

const WIN_REASON: Record<string, { icon: string; label: string }> = {
  elimination:  { icon: '☠', label: 'Elimination' },
  bomb_exploded:{ icon: '💥', label: 'Bomb exploded' },
  bomb_defused: { icon: '🔵', label: 'Bomb defused' },
  time:         { icon: '⏱', label: 'Time ran out' },
}

export default function RoundHistory() {
  const { rounds, selectedDemo } = useDemoStore()
  const { currentRound, setRound } = usePlaybackStore()

  const handleClick = async (roundNum: number) => {
    if (!selectedDemo) return
    setRound(roundNum)
    await loadRoundData(selectedDemo.id, roundNum)
  }

  return (
    <div className="py-1">
      <div className="section-header">Roundit</div>
      <div className="px-2 pb-2 space-y-0.5">
        {rounds.map((r) => {
          const active = currentRound === r.round_num
          const isCT   = r.winner_team === 'CT'
          const reason = WIN_REASON[r.win_reason] ?? { icon: '?', label: '?' }
          return (
            <button
              key={r.round_num}
              onClick={() => handleClick(r.round_num)}
              className={`w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition-all text-xs ${
                active
                  ? 'bg-amber-500/15 border border-amber-500/30 text-cs-text'
                  : 'hover:bg-white/4 text-cs-muted hover:text-cs-text border border-transparent'
              }`}
            >
              {/* Round number */}
              <span className="w-5 text-right font-mono text-cs-muted shrink-0">{r.round_num}</span>

              {/* Winner badge */}
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: isCT ? 'rgba(91,156,246,0.15)' : 'rgba(249,115,22,0.15)',
                  color: isCT ? '#5b9cf6' : '#f97316',
                }}
              >
                {r.winner_team ?? '?'}
              </span>

              {/* Win reason icon */}
              <span title={reason.label} className="text-sm">{reason.icon}</span>

              {/* Kill count */}
              {r.kill_count > 0 && (
                <span className="text-[10px] text-cs-muted">{r.kill_count}k</span>
              )}

              {/* Score */}
              <span className="ml-auto font-mono text-[10px] tabular-nums">
                <span style={{ color: '#f97316' }}>{r.t_score}</span>
                <span className="text-cs-muted mx-0.5">:</span>
                <span style={{ color: '#5b9cf6' }}>{r.ct_score}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
