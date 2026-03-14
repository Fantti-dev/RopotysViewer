import { useEffect, useRef, useMemo } from 'react'
import { usePlaybackStore } from '../stores'

const SPEEDS   = [0.25, 0.5, 1, 2, 4, 8]
const TICKRATE = 64
const BOMB_TIMER_TICKS = 40 * TICKRATE  // 40s

export default function PlaybackBar() {
  const {
    allTicks, currentTick, isPlaying, playbackSpeed,
    setTick, setPlaying, setSpeed,
    kills, bombEvents, grenades, smokeEffects,
  } = usePlaybackStore()

  const rafRef       = useRef<number | null>(null)
  const lastTimeRef  = useRef<number>(0)
  const tickIdxRef   = useRef<number>(0)
  const isPlayingRef = useRef(false)
  const allTicksRef  = useRef(allTicks)
  const speedRef     = useRef(playbackSpeed)

  useEffect(() => { allTicksRef.current = allTicks }, [allTicks])
  useEffect(() => { speedRef.current = playbackSpeed }, [playbackSpeed])
  useEffect(() => {
    const idx = allTicks.findIndex(t => t === currentTick)
    if (idx >= 0) tickIdxRef.current = idx
  }, [currentTick, allTicks])

  useEffect(() => {
    if (!isPlaying) {
      isPlayingRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    isPlayingRef.current = true
    lastTimeRef.current  = performance.now()

    const animate = (now: number) => {
      if (!isPlayingRef.current) return
      const ticks = allTicksRef.current
      if (!ticks.length) return
      const msPerTick     = 1000 / (TICKRATE * speedRef.current)
      const elapsed       = now - lastTimeRef.current
      const totalProgress = elapsed / msPerTick
      const advance       = Math.floor(totalProgress)
      const subProgress   = totalProgress - advance
      if (advance > 0) {
        lastTimeRef.current += advance * msPerTick
        tickIdxRef.current   = Math.min(tickIdxRef.current + advance, ticks.length - 1)
        if (tickIdxRef.current >= ticks.length - 1) {
          usePlaybackStore.setState({ currentTick: ticks[ticks.length - 1], tickProgress: 0, isPlaying: false })
          isPlayingRef.current = false
          return
        }
      }
      usePlaybackStore.setState({ currentTick: ticks[tickIdxRef.current], tickProgress: subProgress })
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { isPlayingRef.current = false; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying, playbackSpeed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const ticks = allTicksRef.current
      if (!ticks.length) return
      if (e.code === 'Space') { e.preventDefault(); usePlaybackStore.setState((s) => ({ isPlaying: !s.isPlaying })); return }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault()
        isPlayingRef.current = false
        usePlaybackStore.setState({ isPlaying: false })
        const step = e.shiftKey ? 64 : 1
        tickIdxRef.current = e.code === 'ArrowRight'
          ? Math.min(tickIdxRef.current + step, ticks.length - 1)
          : Math.max(tickIdxRef.current - step, 0)
        usePlaybackStore.setState({ currentTick: ticks[tickIdxRef.current] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const seekTo = (idx: number) => {
    isPlayingRef.current = false
    usePlaybackStore.setState({ isPlaying: false })
    tickIdxRef.current = idx
    usePlaybackStore.setState({ currentTick: allTicks[idx] })
  }

  const totalTicks = allTicks.length
  const firstTick  = allTicks[0] ?? 0
  const lastTick   = allTicks[totalTicks - 1] ?? 1
  const tickRange  = lastTick - firstTick || 1
  const curIdx     = totalTicks > 0 ? allTicks.findIndex(t => t === currentTick) : 0
  const progress   = totalTicks > 0 ? curIdx / (totalTicks - 1) : 0

  const gameSec  = curIdx > 0 ? curIdx / TICKRATE : 0
  const timeStr  = `${Math.floor(gameSec / 60)}:${String(Math.floor(gameSec % 60)).padStart(2, '0')}`

  // Pommin plant + räjähdys aikajanalle
  const bombZone = useMemo(() => {
    const plant   = bombEvents.find(b => b.event_type === 'plant')
    const explode = bombEvents.find(b => b.event_type === 'explode')
    const defuse  = bombEvents.find(b => b.event_type === 'defuse')
    if (!plant) return null
    const plantPct   = (plant.tick - firstTick) / tickRange
    const endTick    = explode?.tick ?? defuse?.tick ?? (plant.tick + BOMB_TIMER_TICKS)
    const endPct     = (endTick - firstTick) / tickRange
    return { plantPct, endPct, exploded: !!explode, defused: !!defuse }
  }, [bombEvents, firstTick, tickRange])

  // Tapahtumamerkit
  const markers = useMemo(() => {
    const items: { pct: number; color: string; label: string }[] = []
    kills.forEach(k => {
      const pct = (k.tick - firstTick) / tickRange
      if (pct >= 0 && pct <= 1) items.push({ pct, color: '#ef4444', label: `${k.attacker_name} → ${k.victim_name}` })
    })
    grenades.filter(g => g.grenade_type === 'molotov' || g.grenade_type === 'incgrenade').forEach(g => {
      const pct = ((g.tick_detonated ?? g.tick_thrown) - firstTick) / tickRange
      if (pct >= 0 && pct <= 1) items.push({ pct, color: '#f97316', label: 'Molotov' })
    })
    smokeEffects.forEach(s => {
      const pct = (s.start_tick - firstTick) / tickRange
      if (pct >= 0 && pct <= 1) items.push({ pct, color: '#9ca3af', label: 'Savu' })
    })
    return items
  }, [kills, grenades, smokeEffects, firstTick, tickRange])

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seekTo(Math.round(pct * (totalTicks - 1)))
  }

  return (
    <div className="bg-cs-surface border-t border-cs-border select-none">
      {/* Visual timeline */}
      <div className="px-4 pt-2 pb-1">
        <div
          className="relative h-7 rounded-lg overflow-visible cursor-pointer"
          style={{ background: '#0d0f14', border: '1px solid #1e2130' }}
          onClick={handleTrackClick}
        >
          {/* Progress fill */}
          <div
            className="absolute top-0 left-0 h-full rounded-lg"
            style={{ width: `${progress * 100}%`, background: 'rgba(249,115,22,0.15)', pointerEvents: 'none' }}
          />

          {/* Pommi-alue */}
          {bombZone && (
            <div
              className="absolute top-0 h-full"
              style={{
                left: `${bombZone.plantPct * 100}%`,
                width: `${Math.max(0, (bombZone.endPct - bombZone.plantPct)) * 100}%`,
                background: bombZone.defused
                  ? 'rgba(59,130,246,0.25)'
                  : 'rgba(239,68,68,0.28)',
                borderLeft: `2px solid ${bombZone.defused ? '#3b82f6' : '#ef4444'}`,
                pointerEvents: 'none',
              }}
            >
              <span style={{
                position: 'absolute', top: '50%', left: 3,
                transform: 'translateY(-50%)', fontSize: 8,
                color: bombZone.defused ? '#93c5fd' : '#fca5a5',
                whiteSpace: 'nowrap', fontWeight: 700,
              }}>
                {bombZone.defused ? '🔵 Purettu' : bombZone.exploded ? '💥 Räjähti' : 'Pommi'}
              </span>
            </div>
          )}

          {/* Tapahtumamerkit */}
          {markers.map((m, i) => (
            <div
              key={i}
              title={m.label}
              style={{
                position: 'absolute', bottom: 0,
                left: `${m.pct * 100}%`,
                width: 3, height: '60%',
                background: m.color,
                borderRadius: '2px 2px 0 0',
                transform: 'translateX(-50%)',
                opacity: 0.8,
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Kursori */}
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${progress * 100}%`,
              width: 2,
              background: '#f97316',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              position: 'absolute', top: -5, left: '50%',
              transform: 'translateX(-50%)',
              width: 10, height: 10,
              borderRadius: '50%',
              background: '#f97316',
              border: '2px solid #fff',
            }} />
          </div>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 px-4 pb-2">
        <div className="flex items-center gap-1">
          <button onClick={() => seekTo(0)} disabled={!totalTicks}
            className="w-7 h-7 flex items-center justify-center text-cs-muted hover:text-cs-text rounded hover:bg-white/8 disabled:opacity-30 text-sm transition-colors" title="Alku">⏮</button>
          <button onClick={() => seekTo(Math.max(curIdx - 64, 0))} disabled={!totalTicks}
            className="w-7 h-7 flex items-center justify-center text-cs-muted hover:text-cs-text rounded hover:bg-white/8 disabled:opacity-30 transition-colors" title="−1s">◀◀</button>
          <button onClick={() => setPlaying(!isPlaying)} disabled={!totalTicks}
            className="w-9 h-9 flex items-center justify-center rounded-full font-bold hover:brightness-110 disabled:opacity-30 text-base transition-all"
            style={{ background: '#f59e0b', color: '#000' }} title="Play/Pause (Space)">
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={() => seekTo(Math.min(curIdx + 64, totalTicks - 1))} disabled={!totalTicks}
            className="w-7 h-7 flex items-center justify-center text-cs-muted hover:text-cs-text rounded hover:bg-white/8 disabled:opacity-30 transition-colors" title="+1s">▶▶</button>
        </div>

        <div className="font-mono text-sm text-cs-text tabular-nums min-w-[80px]">
          {totalTicks > 0 ? timeStr : '0:00'}
        </div>
        <div className="font-mono text-xs text-cs-muted tabular-nums">
          {totalTicks > 0 ? `tick ${currentTick.toLocaleString()}` : ''}
        </div>

        {/* Pommilegenda */}
        {bombZone && (
          <div className="flex items-center gap-2 text-[10px]">
            <span style={{ color: '#fca5a5' }}>● Pommi asetettu</span>
            {bombZone.defused && <span style={{ color: '#93c5fd' }}>● Purettu</span>}
            {bombZone.exploded && <span style={{ color: '#ef4444' }}>● Räjähti</span>}
          </div>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1 bg-black/30 rounded-lg p-1">
          {SPEEDS.map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                playbackSpeed === s ? 'bg-cs-accent text-black font-bold' : 'text-cs-muted hover:text-cs-text hover:bg-white/8'
              }`}>{s}x</button>
          ))}
        </div>
      </div>
    </div>
  )
}