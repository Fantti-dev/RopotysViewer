import { useEffect, useState } from 'react'
import { useDemoStore } from './stores'
import DemoList from './sidebar/DemoList'
import LayerToggles from './sidebar/LayerToggles'
import PlayerList from './sidebar/PlayerList'
import RoundHistory from './sidebar/RoundHistory'
import MapCanvas from './viewer/MapCanvas'
import PlaybackBar from './controls/PlaybackBar'
import Scoreboard from './controls/Scoreboard'

export default function App() {
  const { refreshDemos } = useDemoStore()
  const [demoOpen, setDemoOpen] = useState(false)

  useEffect(() => { refreshDemos() }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', background: '#0d0f14',
      overflow: 'hidden', fontFamily: 'Inter,system-ui,sans-serif',
    }}>
      {/* TOP: Scoreboard + demo-nappi */}
      <div style={{ display:'flex', alignItems:'stretch', borderBottom:'1px solid #1e2130', background:'#111420', flexShrink:0 }}>
        <button
          onClick={() => setDemoOpen(v => !v)}
          style={{
            padding:'0 16px', borderRight:'1px solid #1e2130',
            background: demoOpen ? '#f97316' : 'transparent',
            color: demoOpen ? '#fff' : '#9ca3af',
            fontSize:11, fontWeight:700, cursor:'pointer',
            border:'none', borderRight:'1px solid #1e2130',
            flexShrink:0,
          }}
        >
          ☰ Demot
        </button>
        <div style={{ flex:1 }}>
          <Scoreboard />
        </div>
      </div>

      {/* KESKI: kartta + oikea sidebar */}
      <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

        {/* Kartta — PlayerList floattaa tämän päällä */}
        <div style={{ flex:1, position:'relative', background:'#0d0f14', overflow:'hidden' }}>
          <MapCanvas />
          <PlayerList />
        </div>

        {/* Oikea sidebar: layerit + roundit */}
        <div style={{
          width:180, display:'flex', flexDirection:'column',
          background:'#111420', borderLeft:'1px solid #1e2130',
          flexShrink:0, overflow:'hidden',
        }}>
          <LayerToggles />
          <div style={{ borderTop:'1px solid #1e2130', flex:1, overflowY:'auto' }}>
            <RoundHistory />
          </div>
        </div>

      </div>

      {/* PLAYBACK */}
      <PlaybackBar />

      {/* DEMO MODAL */}
      {demoOpen && (
        <div
          style={{
            position:'fixed', inset:0, zIndex:100,
            background:'rgba(0,0,0,0.6)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setDemoOpen(false) }}
        >
          <div style={{
            width:480, maxHeight:'80vh',
            background:'#111420', borderRadius:16,
            border:'1px solid #1e2130',
            overflow:'hidden', display:'flex', flexDirection:'column',
          }}>
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'12px 16px', borderBottom:'1px solid #1e2130',
            }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>Demot</span>
              <button
                onClick={() => setDemoOpen(false)}
                style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:16 }}
              >✕</button>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              <DemoList onSelect={() => setDemoOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}