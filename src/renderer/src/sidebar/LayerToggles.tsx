import { useLayerStore } from '../stores'

const LAYERS = [
  { key: 'players',       label: 'Pelaajat',     color: '#5b9cf6' },
  { key: 'playerTrails',  label: 'Polut',        color: '#94a3b8' },
  { key: 'playerLabels',  label: 'Nimet / HP',   color: '#94a3b8' },
  { key: 'kills',         label: 'Tapot',        color: '#ef4444' },
  { key: 'killLines',     label: 'Tappolinjat',  color: '#ef4444' },
  { key: 'grenades',      label: 'Kranaatit',    color: '#f59e0b' },
  { key: 'smokes',        label: 'Savut',        color: '#9ca3af' },
  { key: 'bomb',          label: 'Pommi',        color: '#f97316' },
  { key: 'shots',         label: 'Laukaukset',   color: '#fcd34d' },
  { key: 'heatmap',       label: 'Lämpökartta',  color: '#f87171' },
] as const

export default function LayerToggles() {
  const store = useLayerStore()

  return (
    <div style={{ padding:'8px 0' }}>
      <div style={{
        fontSize:9, fontWeight:700, letterSpacing:'.8px',
        color:'#374151', textTransform:'uppercase',
        padding:'6px 14px 8px',
      }}>Tasot</div>

      {LAYERS.map(({ key, label, color }) => {
        const active = store[key as keyof typeof store] as boolean
        return (
          <button
            key={key}
            onClick={() => store.toggle(key)}
            style={{
              width:'100%', display:'flex', alignItems:'center',
              gap:10, padding:'6px 14px',
              background: active ? 'rgba(249,115,22,0.06)' : 'transparent',
              border:'none', cursor:'pointer',
              transition:'background .12s',
              borderLeft: active ? '2px solid #f97316' : '2px solid transparent',
            }}
          >
            {/* Värillinen piste */}
            <span style={{
              width:7, height:7, borderRadius:'50%',
              background: color,
              opacity: active ? 1 : 0.25,
              flexShrink:0,
            }}/>

            {/* Label */}
            <span style={{
              fontSize:11, flex:1, textAlign:'left',
              color: active ? '#e2e8f0' : '#4b5563',
              transition:'color .12s',
            }}>
              {label}
            </span>

            {/* Toggle pill */}
            <span style={{
              width:28, height:14, borderRadius:7,
              background: active ? '#f97316' : '#1e2130',
              position:'relative', flexShrink:0,
              transition:'background .15s',
            }}>
              <span style={{
                position:'absolute', top:2,
                left: active ? 16 : 2,
                width:10, height:10, borderRadius:'50%',
                background:'#fff',
                transition:'left .15s',
              }}/>
            </span>
          </button>
        )
      })}
    </div>
  )
}