import { useDemoStore, usePlaybackStore } from '../stores'
import { loadRoundData } from './RoundSelector'

export default function Scoreboard() {
  const { selectedDemo, rounds } = useDemoStore()
  const { currentRound, setRound, kills, currentTick } = usePlaybackStore()

  if (!selectedDemo) return (
    <div style={{
      height: 44, display:'flex', alignItems:'center', justifyContent:'center',
      borderBottom:'1px solid #1e2130', background:'#111420',
    }}>
      <span style={{ fontSize:11, color:'#4b5563' }}>Valitse demo vasemmasta paneelista</span>
    </div>
  )

  const cur     = rounds.find(r => r.round_num === currentRound)
  const ctScore = cur?.ct_score ?? 0
  const tScore  = cur?.t_score  ?? 0

  // Live-skori tällä hetkellä: laske tapot per tiimi tässä roundissa
  const roundKills = kills.filter(k => k.tick <= currentTick)
  const ctKills = roundKills.filter(k => {
    // CT tappoi = uhri on T (approx: käytetään killer_team jos saatavilla)
    return true // yksinkertaistettu — näytetään vain round-skori
  })

  const handleClick = async (roundNum: number) => {
    setRound(roundNum)
    await loadRoundData(selectedDemo.id, roundNum)
  }

  const mainRounds = rounds.filter(r => r.round_num >= 1  && r.round_num <= 12)
  const lateRounds = rounds.filter(r => r.round_num >= 13 && r.round_num <= 24)
  const otRounds   = rounds.filter(r => r.round_num >= 25)

  const RoundBtn = ({ r }: { r: typeof rounds[0] }) => {
    const active = currentRound === r.round_num
    const won    = r.winner_team
    return (
      <button
        onClick={() => handleClick(r.round_num)}
        title={`Erä ${r.round_num}: ${won ?? '?'} voitti`}
        style={{
          width: 26, height: 26, borderRadius: 8,
          fontSize: 11, fontWeight: active ? 700 : 500,
          cursor: 'pointer', transition: 'all .12s',
          transform: active ? 'scale(1.1)' : 'scale(1)',
          background: active ? '#f97316'
            : won === 'CT' ? 'rgba(91,156,246,0.15)'
            : won === 'T'  ? 'rgba(249,115,22,0.15)'
            : 'rgba(255,255,255,0.04)',
          color: active ? '#fff'
            : won === 'CT' ? '#5b9cf6'
            : won === 'T'  ? '#f97316'
            : '#6b7280',
          border: active ? '1px solid #f97316'
            : won === 'CT' ? '1px solid rgba(91,156,246,0.25)'
            : won === 'T'  ? '1px solid rgba(249,115,22,0.25)'
            : '1px solid transparent',
        }}
      >
        {r.round_num}
      </button>
    )
  }

  return (
    <div style={{ background:'#111420', borderBottom:'1px solid #1e2130' }}>
      <div style={{ display:'flex', alignItems:'center', padding:'6px 14px', gap:12 }}>

        {/* RS logo */}
        <div style={{
          background:'#f97316', borderRadius:8,
          padding:'3px 10px', fontSize:11,
          fontWeight:800, color:'#fff', letterSpacing:.5,
          flexShrink:0,
        }}>RS</div>

        {/* CT skori */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:1, color:'#5b9cf6' }}>CT</span>
          <span style={{ fontSize:20, fontWeight:800, color:'#5b9cf6', fontVariantNumeric:'tabular-nums' }}>{ctScore}</span>
        </div>

        {/* Erät */}
        <div style={{ flex:1, display:'flex', alignItems:'center', gap:3, flexWrap:'wrap', justifyContent:'center' }}>
          {mainRounds.map(r => <RoundBtn key={r.round_num} r={r} />)}
          {lateRounds.length > 0 && <>
            <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
            {lateRounds.map(r => <RoundBtn key={r.round_num} r={r} />)}
          </>}
          {otRounds.length > 0 && <>
            <div style={{ width:1, height:16, background:'#1e2130', margin:'0 2px' }}/>
            {otRounds.map(r => <RoundBtn key={r.round_num} r={r} />)}
          </>}
        </div>

        {/* T skori */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <span style={{ fontSize:20, fontWeight:800, color:'#f97316', fontVariantNumeric:'tabular-nums' }}>{tScore}</span>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:1, color:'#f97316' }}>T</span>
        </div>

        {/* Karttanimi */}
        <span style={{ fontSize:10, color:'#4b5563', borderLeft:'1px solid #1e2130', paddingLeft:12, flexShrink:0 }}>
          {selectedDemo.map_name}
        </span>

      </div>
    </div>
  )
}