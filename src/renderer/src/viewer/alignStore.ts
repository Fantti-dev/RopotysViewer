import { create } from 'zustand'

// Yksi alignment-piste: CS2-koordinaatit (2D-mapista) + Three.js-koordinaatit (3D-mallilta)
export interface AlignPoint {
  cs2x: number   // CS2 world X (saadaan 2D-mapista)
  cs2y: number   // CS2 world Y (saadaan 2D-mapista)
  modelX: number // Three.js X (saadaan 3D-mallilta)
  modelY: number // Three.js Y
  modelZ: number // Three.js Z
  has2D: boolean
  has3D: boolean
}

interface AlignState {
  active: boolean          // onko align-moodi päällä
  points: AlignPoint[]     // max 2 pistettä
  nextSlot: 0 | 1         // kumpi piste on vuorossa

  setActive: (v: boolean) => void
  set2DPoint: (x: number, y: number) => void
  set3DPoint: (x: number, y: number, z: number) => void
  reset: () => void
}

const emptyPoint = (): AlignPoint => ({
  cs2x: 0, cs2y: 0, modelX: 0, modelY: 0, modelZ: 0,
  has2D: false, has3D: false,
})

export const useAlignStore = create<AlignState>((set, get) => ({
  active: false,
  points: [emptyPoint(), emptyPoint()],
  nextSlot: 0,

  setActive: (v) => set({ active: v }),

  // Kutsutaan kun käyttäjä klikkaa 2D-mappia — tallentaa CS2-koordinaatit
  set2DPoint: (x, y) => set(s => {
    const slot = s.nextSlot
    const pts  = s.points.map((p, i) => i === slot ? { ...p, cs2x: x, cs2y: y, has2D: true } : p) as [AlignPoint, AlignPoint]
    return { points: pts }
  }),

  // Kutsutaan kun käyttäjä klikkaa 3D-mallia — tallentaa Three.js-koordinaatit
  // ja siirtää vuoron seuraavaan pisteeeseen
  set3DPoint: (x, y, z) => set(s => {
    const slot = s.nextSlot
    const pts  = s.points.map((p, i) => i === slot ? { ...p, modelX: x, modelY: y, modelZ: z, has3D: true } : p) as [AlignPoint, AlignPoint]
    const next = slot === 0 ? 1 : 1  // pysy 1:ssä jos molemmat täynnä
    return { points: pts, nextSlot: (slot < 1 ? slot + 1 : 1) as 0 | 1 }
  }),

  reset: () => set({ points: [emptyPoint(), emptyPoint()], nextSlot: 0 }),
}))
