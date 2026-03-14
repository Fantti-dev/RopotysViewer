export default function TitleBar() {
  return (
    <div
      className="h-9 flex items-center justify-between px-3 bg-cs-panel border-b border-cs-border shrink-0"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Logo */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <span className="text-cs-accent font-bold text-sm tracking-widest">CS2</span>
        <span className="text-gray-400 text-xs">DEMO REVIEW</span>
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          className="w-7 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-cs-border rounded text-xs transition-colors"
          title="Pienennä"
        >─</button>
        <button
          onClick={() => window.electronAPI.maximizeWindow()}
          className="w-7 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-cs-border rounded text-xs transition-colors"
          title="Suurenna"
        >□</button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          className="w-7 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 rounded text-xs transition-colors"
          title="Sulje"
        >✕</button>
      </div>
    </div>
  )
}
