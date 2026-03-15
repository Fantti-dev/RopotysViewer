import { useState } from 'react'
import { useDemoStore, usePlaybackStore } from '../stores'
import { loadRoundData, preloadRoundsSilently, stopRoundPreload } from '../controls/RoundSelector'
import { clearCache } from '../roundCache'

export default function DemoList({ onSelect }: { onSelect?: () => void } = {}) {
  const {
    demos, selectedDemo, setSelectedDemo,
    setPlayers, setRounds, isLoading, setLoading,
    parseProgress, addParseProgress, clearParseProgress,
    refreshDemos
  } = useDemoStore()

  const { setRound } = usePlaybackStore()

  const [showProgress, setShowProgress] = useState(false)
  const [posProgress, setPosProgress] = useState(0)  // 0-100

  const handleOpenDemo = async () => {
    const paths = await window.electronAPI.openDemoDialog()
    if (!paths || paths.length === 0) return

    setLoading(true)
    setShowProgress(true)
    clearParseProgress()

    // Kuuntele progress-viestejä
    const unsub = window.electronAPI.onParserProgress((msg) => {
      if (msg.startsWith('PROGRESS:positions:')) {
        const pct = parseInt(msg.split(':')[2])
        setPosProgress(pct)
      } else {
        addParseProgress(msg)
      }
    })

    try {
      for (const path of paths) {
        addParseProgress(`⏳ Parsitaan: ${path.split('\\').pop()}`)
        await window.electronAPI.parseDemo(path)
        addParseProgress(`✅ Valmis!`)
      }
      await refreshDemos()
    } catch (err: any) {
      addParseProgress(`❌ Virhe: ${err.message}`)
    } finally {
      unsub()
      setLoading(false)
    }
  }

  const handleSelectDemo = async (demo: typeof demos[0]) => {
    stopRoundPreload()
    setSelectedDemo(demo)
    setLoading(true)
    clearCache()  // Tyhjennä vanha demo pois
    setRoundPreload(0, 0, false)
    try {
      const [players, rounds] = await Promise.all([
        window.electronAPI.getPlayers(demo.id),
        window.electronAPI.getRounds(demo.id),
      ])
      setPlayers(players)
      setRounds(rounds)

      const firstRound = rounds.length > 0 ? rounds[0].round_num : 0
      setRound(firstRound)

      // Lataa ensimmäinen kierros heti
      await loadRoundData(demo.id, firstRound)


    } catch(e) {
      setLoading(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, demoId: number) => {
    e.stopPropagation()
    if (!confirm('Poista demo ja kaikki sen data?')) return
    await window.electronAPI.deleteDemo(demoId)
    await refreshDemos()
    if (selectedDemo?.id === demoId) setSelectedDemo(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-cs-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-cs-muted">Demot</span>
          <span className="text-[10px] text-cs-muted bg-white/5 rounded px-1.5 py-0.5">{demos.length}</span>
        </div>
        <button
          onClick={handleOpenDemo}
          disabled={isLoading}
          className="w-full py-2 rounded-md text-sm font-semibold transition-all disabled:opacity-50"
          style={{ background: '#f59e0b', color: '#000' }}
        >
          {isLoading ? '⏳ Parsitaan...' : '+ Avaa Demo'}
        </button>
      </div>

      {/* Progress log */}
      {showProgress && parseProgress.length > 0 && (
        <div className="p-2 border-b border-cs-border bg-black/20">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-cs-muted uppercase tracking-wider">Parsinta</span>
            <button onClick={() => setShowProgress(false)} className="text-cs-muted hover:text-cs-text text-xs">✕</button>
          </div>
          {posProgress > 0 && posProgress < 100 && (
            <div className="mb-2">
              <div className="flex justify-between text-[10px] text-cs-muted mb-1">
                <span>Sijainnit</span><span>{posProgress}%</span>
              </div>
              <div className="w-full h-1 bg-white/10 rounded overflow-hidden">
                <div className="h-full rounded transition-all" style={{ width: `${posProgress}%`, background: '#f59e0b' }} />
              </div>
            </div>
          )}
          <div className="max-h-28 overflow-y-auto space-y-0.5">
            {parseProgress.map((msg, i) => (
              <div key={i} className="text-[10px] font-mono text-cs-muted leading-4">{msg}</div>
            ))}
          </div>
        </div>
      )}

      {/* Demo lista */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {demos.length === 0 && (
          <div className="text-center text-cs-muted text-xs mt-10 px-4 leading-6">
            <div className="text-3xl mb-3 opacity-30">🎮</div>
            Ei demoja.<br />Klikkaa "+ Avaa Demo"
          </div>
        )}
        {demos.map((demo) => (
          <div
            key={demo.id}
            onClick={() => handleSelectDemo(demo)}
            className={`relative p-2.5 rounded-lg cursor-pointer border transition-all ${
              selectedDemo?.id === demo.id
                ? 'border-amber-500/40 bg-amber-500/8'
                : 'border-cs-border hover:border-cs-border2 hover:bg-white/3'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-cs-accent">{demo.map_name}</span>
              <button
                onClick={(e) => handleDelete(e, demo.id)}
                className="w-5 h-5 flex items-center justify-center text-cs-muted hover:text-red-400 rounded text-xs transition-colors opacity-0 group-hover:opacity-100"
                title="Poista">×</button>
            </div>
            <div className="text-[10px] text-cs-muted truncate mb-1.5" title={demo.filename}>
              {demo.filename.split('\\').pop()}
            </div>
            <div className="flex gap-2 text-[10px] text-cs-muted">
              <span>{demo.round_count} rounds</span>
              <span>·</span>
              <span>{demo.player_count} players</span>
              <span className="ml-auto">{new Date(demo.parsed_at).toLocaleDateString('fi-FI')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
