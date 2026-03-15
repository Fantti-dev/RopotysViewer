import { useEffect, useState } from 'react'
import { useDemoStore } from './stores'
import DemoList from './sidebar/DemoList'
import LayerToggles from './sidebar/LayerToggles'
import PlayerList from './sidebar/PlayerList'
import MapCanvas from './viewer/MapCanvas'
import PlaybackBar from './controls/PlaybackBar'
import Scoreboard from './controls/Scoreboard'
import RoundScoreboard from './controls/RoundScoreboard'
import Viewer3D from './viewer/Viewer3D'

export default function App() {
  const { refreshDemos } = useDemoStore()
  const [demoOpen,       setDemoOpen]       = useState(false)
  const [show3D,         setShow3D]         = useState(false)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [showLayers,     setShowLayers]     = useState(false)

  useEffect(() => { refreshDemos() }, [])

  const btnStyle = (active: boolean, activeColor = '#f97316') => ({
    padding: '0 14px',
    background: active ? activeColor : 'transparent',
    color: active ? '#fff' : '#9ca3af',
    fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: 'none', borderRight: '1px solid #1e2130',
    flexShrink: 0, height: '100%',
    transition: 'background .12s, color .12s',
  })

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', background: '#0d0f14',
      overflow: 'hidden', fontFamily: 'Inter,system-ui,sans-serif',
    }}>

      {/* Yläpalkki */}
      <div style={{ display:'flex', alignItems:'stretch', borderBottom:'1px solid #1e2130', background:'#111420', flexShrink:0 }}>
        <button onClick={() => setDemoOpen(v => !v)} style={btnStyle(demoOpen)}>☰ Demot</button>
        <button onClick={() => setShowScoreboard(v => !v)} style={btnStyle(showScoreboard, '#5b9cf6')}>⊞ Tilastot</button>
        <button onClick={() => setShowLayers(v => !v)} style={btnStyle(showLayers, '#6b7280')}>≡ Tasot</button>
        <button onClick={() => setShow3D(v => !v)} style={btnStyle(show3D, '#8b5cf6')}>⬡ 3D</button>
        <div style={{ flex:1 }}>
          <Scoreboard />
        </div>
      </div>

      {/* Pääalue — kartta täyttää kaiken */}
      <div style={{ flex:1, position:'relative', background:'#0d0f14', overflow:'hidden' }}>
        <MapCanvas />
        {!show3D && !showScoreboard && <PlayerList />}

        {/* Tilastonäkymä */}
        {showScoreboard && (
          <RoundScoreboard onClose={() => setShowScoreboard(false)} />
        )}

        {/* Layer-drawer kartan päällä oikealla */}
        {showLayers && (
          <div style={{
            position:'absolute', top:0, right:0, bottom:0, zIndex:40,
            width:180, background:'rgba(13,15,20,0.97)',
            borderLeft:'1px solid #1e2130', overflowY:'auto',
          }}>
            <LayerToggles />
          </div>
        )}
      </div>

      <PlaybackBar />

      {/* Demo-modal */}
      {demoOpen && (
        <div
          style={{ position:'fixed', inset:0, zIndex:100, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setDemoOpen(false) }}
        >
          <div style={{ width:480, maxHeight:'80vh', background:'#111420', borderRadius:16, border:'1px solid #1e2130', overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #1e2130' }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>Demot</span>
              <button onClick={() => setDemoOpen(false)} style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:16 }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              <DemoList onSelect={() => setDemoOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {show3D && <Viewer3D onClose={() => setShow3D(false)} />}
    </div>
  )
}