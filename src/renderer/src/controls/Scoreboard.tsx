import { useDemoStore, usePlaybackStore } from '../stores'
import { loadRoundData, KNIFE_ROUND } from './RoundSelector'

export default function Scoreboard() {
  const { selectedDemo, rounds, preloadTotal, preloadDone, preloadActive } = useDemoStore()
  const { currentRound, setRound } = usePlaybackStore()

  if (!selectedDemo) return (
    <div style={{ height:44, display:'flex', alignItems:'center', justifyContent:'center', borderBottom:'1px solid #1e2130', background:'#111420' }}>
      <span style={{ fontSize:11, color:'#4b5563' }}>Valitse demo vasemmasta paneelista</span>
    </div>
  )

  const cur     = rounds.find(r => r.round_num === currentRound)
  const ctScore = cur?.ct_score ?? 0
  const tScore  = cur?.t_score  ?? 0

  const handleClick = (roundNum: number) => {
    setRound(roundNum)
    loadRoundData(selectedDemo.id, roundNum)
  }

  const knifes = rounds.filter(r => r.is_knife)
  const half1  = rounds.filter(r => !r.is_knife && r.round_num <= 12)
  const half2  = rounds.filter(r => !r.is_knife && r.round_num >= 13 && r.round_num <= 24)
  const ot     = rounds.filter(r => !r.is_knife && r.round_num >= 25)

  const RoundBtn = ({ r }: { r: typeof rounds[0] }) => {
    const active  = currentRound === r.round_num
    const won     = r.winner_team
    const isKnife = r.is_knife
    return (
      <button
        onClick={() => handleClick(r.round_num)}
        title={isKnife ? 'Puukkokierros 🔪' : `Erä ${r.round_num}: ${won ?? '?'} voitti`}
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
    <div style={{ background:'#111420', borderBottom:'1px solid #1e2130' }}>
      <div style={{ display:'flex', alignItems:'center', padding:'6px 14px', gap:12 }}>

        <div style={{ background:'#f97316', borderRadius:8, padding:'3px 10px', fontSize:11, fontWeight:800, color:'#fff', letterSpacing:.5, flexShrink:0 }}>RS</div>

        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:1, color:'#5b9cf6' }}>CT</span>
          <span style={{ fontSize:20, fontWeight:800, color:'#5b9cf6', fontVariantNumeric:'tabular-nums' }}>{ctScore}</span>
        </div>

        <div style={{ flex:1, display:'flex', alignItems:'center', gap:3, flexWrap:'wrap', justifyContent:'center' }}>
          {knifes.length > 0 && <>
            {knifes.map(r => <RoundBtn key={r.round_num} r={r} />)}
            <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
          </>}
          {half1.map(r => <RoundBtn key={r.round_num} r={r} />)}
          {half2.length > 0 && <>
            <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
            {half2.map(r => <RoundBtn key={r.round_num} r={r} />)}
          </>}
          {ot.length > 0 && <>
            <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
            {ot.map(r => <RoundBtn key={r.round_num} r={r} />)}
          </>}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <span style={{ fontSize:20, fontWeight:800, color:'#f97316', fontVariantNumeric:'tabular-nums' }}>{tScore}</span>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:1, color:'#f97316' }}>T</span>
        </div>

        <span style={{ fontSize:10, color:'#4b5563', borderLeft:'1px solid #1e2130', paddingLeft:12, flexShrink:0 }}>
          {selectedDemo.map_name}
        </span>

      </div>

      {/* Preload progressbar */}
      {preloadActive && (
        <div style={{ padding:'3px 14px 4px', background:'#0d0f14' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
            <span style={{ fontSize:9, color:'#6b7280' }}>
              Ladataan kierroksia muistiin... {preloadDone}/{preloadTotal}
            </span>
            <span style={{ fontSize:9, color:'#f97316', marginLeft:'auto' }}>
              {Math.round((preloadDone / Math.max(preloadTotal, 1)) * 100)}%
            </span>
          </div>
          <div style={{ height:2, background:'#1e2130', borderRadius:1 }}>
            <div style={{
              height:'100%', borderRadius:1,
              background:'linear-gradient(90deg, #f97316, #fb923c)',
              width:`${(preloadDone / Math.max(preloadTotal, 1)) * 100}%`,
              transition:'width .3s ease',
            }}/>
          </div>
        </div>
      )}
    </div>
  )
}