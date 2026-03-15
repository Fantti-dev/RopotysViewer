import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { usePlaybackStore, useDemoStore, useLayerStore } from '../stores'
import { getMapConfig } from './mapUtils'
import KillFeed from './KillFeed'

// ── Vakiot ────────────────────────────────────────────────────────────────────
const S               = 0.5
const EYE_HEIGHT      = 64
const EYE_CROUCH      = 46
const TICKRATE        = 64
const TRAIL_TICKS     = 24
const BOMB_TIMER_S    = 40
const BLOOM_TICKS     = 128
const SHOT_FADE_TICKS = 48
const HITMARK_FADE_TICKS = 64
const BLAST_TICKS     = 48
const MOLOTOV_TICKS   = 384

const CT   = 0x5b9cf6
const T    = 0xf97316
const DEAD = 0x444444

const GREN: Record<string, number> = {
  smokegrenade: 0x9ca3af,
  flashbang:    0xfef08a,
  hegrenade:    0xef4444,
  molotov:      0xf97316,
  incgrenade:   0xf97316,
  decoy:        0x86efac,
}

// ── Koordinaattimuunnos ───────────────────────────────────────────────────────
// CS2: X=oikea, Y=syvyys(kartalla alas), Z=ylös
// Three.js: X=oikea, Y=ylös, Z=kohti katsojaa
function c(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x * S, z * S, -y * S)
}

function yaw3(deg: number): number {
  const rad = deg * Math.PI / 180
  return Math.PI / 2 - rad + Math.PI
}

function shotDir(yawDeg: number, pitchDeg: number, dist: number): THREE.Vector3 {
  // c() maps CS2_Y → Three.js -Z, so the Z component must be negated
  // CS2 direction (cos(yaw), sin(yaw), 0) → Three.js (cos(yaw), 0, -sin(yaw))
  const y = yawDeg   * Math.PI / 180
  const p = pitchDeg * Math.PI / 180
  return new THREE.Vector3(
     Math.cos(p) *  Math.cos(y) * dist,   // X: sama
    -Math.sin(p)                * dist,   // Y: pitch
    -Math.cos(p) *  Math.sin(y) * dist    // Z: negatiivinen koska c() peilaa Y→-Z
  )
}

interface Props { onClose: () => void }

export default function Viewer3D({ onClose }: Props) {
  const mountRef    = useRef<HTMLDivElement>(null)
  const sceneRef    = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const animRef     = useRef<number>(0)

  const {
    positions, kills, grenades, grenadeTrajectories,
    smokeEffects, bombEvents, flashEvents, infernoFires, shots,
    damage, currentTick, allTicks, currentRound, tickProgress,
  } = usePlaybackStore()
  const { selectedDemo, players, rounds } = useDemoStore()
  const L = useLayerStore()

  const [localTick, setLocalTick] = useState(currentTick)
  const [playing,   setPlaying]   = useState(false)
  const playRef = useRef(false)

  // Karttamallin säädöt
  const [mapScale,  setMapScale]  = useState(S)
  const [mapOffX,   setMapOffX]   = useState(0)
  const [mapOffY,   setMapOffY]   = useState(0)
  const [mapOffZ,   setMapOffZ]   = useState(0)
  const [showMapControls, setShowMapControls] = useState(false)

  // Align-tila — paikallinen, ei jaettua storea
  type AlignPt = {cs2x:number,cs2y:number,mx:number,mz:number,step:'2d'|'done'}
  const [alignMode, setAlignMode] = useState(false)
  const [alignPts,  setAlignPts]  = useState<AlignPt[]>([])


  const teamMap = Object.fromEntries(players.map(p => [String(p.steam_id), p.team_start]))
  const nameMap = Object.fromEntries(players.map(p => [String(p.steam_id), p.name]))

  const tickToIndex = useMemo(() => {
    const m = new Map<number, number>()
    allTicks.forEach((t, i) => m.set(t, i))
    return m
  }, [allTicks])

  const posBySteam = useMemo(() => {
    const bySteam: Record<string, typeof positions> = {}
    for (const p of positions) {
      const sid = String(p.steam_id)
      ;(bySteam[sid] ??= []).push(p)
    }
    for (const sid of Object.keys(bySteam)) {
      bySteam[sid].sort((a, b) => a.tick - b.tick)
    }
    return bySteam
  }, [positions])

  const trajByGrenade = useMemo(() => {
    const map: Record<number, typeof grenadeTrajectories> = {}
    for (const pt of grenadeTrajectories) {
      ;(map[pt.grenade_id] ??= []).push(pt)
    }
    for (const id of Object.keys(map)) {
      map[Number(id)].sort((a, b) => a.tick - b.tick)
    }
    return map
  }, [grenadeTrajectories])

  const findPosAtTick = (steamId: string, tick: number) => {
    const track = posBySteam[steamId]
    if (!track || track.length === 0) return null
    let lo = 0
    let hi = track.length - 1
    let best: any = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const row = track[mid]
      if (row.tick <= tick) {
        best = row
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return best
  }

  // ── Three.js init ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return
    const W = mountRef.current.clientWidth  || 900
    const H = mountRef.current.clientHeight || 600

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0c12)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.5, 8000)
    camera.position.set(0, 120, 300)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: false })  // antialias pois → iso FPS-parannus
    renderer.setSize(W, H)
    renderer.setPixelRatio(1)  // ei retina-skaalaus → nopea
    renderer.shadowMap.enabled = false
    mountRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(200, 600, 200)
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x8899cc, 0.5)
    fill.position.set(-300, 200, -300)
    scene.add(fill)
    const bounce = new THREE.DirectionalLight(0xffeecc, 0.3)
    bounce.position.set(0, -200, 0)
    scene.add(bounce)

    // Grid piilotettu — karttakuva näytetään pohjalla
    // const grid = new THREE.GridHelper(3200, 100, 0x1a2035, 0x111827)
    // scene.add(grid)

    // Dynaaminen ryhmä pelaajille, laukauksille jne.
    // Tyhjennetään group.clear():llä traversen sijaan — paljon nopeampi
    const dynGroup = new THREE.Group()
    dynGroup.name = 'dynamic'
    scene.add(dynGroup)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping      = true
    controls.dampingFactor      = 0.06
    controls.screenSpacePanning = true
    controls.minDistance        = 2
    controls.maxDistance        = 2000
    controls.zoomSpeed          = 2.0
    controls.target.set(0, 18, 0)
    controls.update()
    controlsRef.current = controls

    const raycaster   = new THREE.Raycaster()
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault()
      const rect  = renderer.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
       -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(mouse, camera)
      const hit = new THREE.Vector3()
      raycaster.ray.intersectPlane(groundPlane, hit)
      if (hit) {
        const lerp = e.deltaY < 0 ? 0.15 : -0.05
        controls.target.lerp(hit, lerp)
      }
    }, { passive: false })

    // ── WASD-liike ──────────────────────────────────────────────────────────
    const keys: Record<string, boolean> = {}
    const onKeyDown = (e: KeyboardEvent) => {
      // Älä ota over jos käyttäjä kirjoittaa inputtiin
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      keys[e.code] = true
      // Estä selaimen omat WASD-scrollit 3D-ikkunassa
      if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].includes(e.code)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => { keys[e.code] = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)

    const moveVec  = new THREE.Vector3()
    const right    = new THREE.Vector3()
    const forward  = new THREE.Vector3()
    const up       = new THREE.Vector3(0, 1, 0)

    const loop = () => {
      animRef.current = requestAnimationFrame(loop)
      controls.update()

      // Nopeus skaalautuu etäisyyden mukaan — kaukaa nopea, läheltä tarkka
      const dist  = camera.position.distanceTo(controls.target)
      const speed = Math.max(1, dist * 0.04)

      moveVec.set(0, 0, 0)

      if (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'] || keys['KeyQ'] || keys['KeyE']) {
        // Forward = kameran suunta maatasolla (ei pystykomponenttia)
        forward.subVectors(controls.target, camera.position).normalize()
        forward.y = 0
        forward.normalize()
        // Right = forward × up
        right.crossVectors(forward, up).normalize()

        if (keys['KeyW']) moveVec.addScaledVector(forward,  speed)
        if (keys['KeyS']) moveVec.addScaledVector(forward, -speed)
        if (keys['KeyA']) moveVec.addScaledVector(right,   -speed)
        if (keys['KeyD']) moveVec.addScaledVector(right,    speed)
        if (keys['KeyE']) moveVec.y +=  speed * 0.6
        if (keys['KeyQ']) moveVec.y += -speed * 0.6

        camera.position.add(moveVec)
        controls.target.add(moveVec)
      }

      renderer.render(scene, camera)
    }
    loop()

    const onResize = () => {
      if (!mountRef.current) return
      const w = mountRef.current.clientWidth
      const h = mountRef.current.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animRef.current)
      controls.dispose()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      window.removeEventListener('resize',  onResize)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // ── 3D karttamalli (GLTF) tai fallback 2D-kuva ───────────────────────────
  // CS2-koordinaatisto: X=oikea, Y=alas(pohjoinen), Z=ylös
  // Blender/GLTF: X=oikea, Y=ylös, Z=ulos → sama kuin CS2 Z=ylös jos exportattu oikein
  // Muunnos: Three.js = (x*S, z*S, -y*S)  ← sama kuin c()
  // GLTF-malli on jo CS2-koordinaateissa, joten:
  //   - rotation.x = -PI/2 (Y-ylös → Y-syvyys kääntö ei tarvita jos Blender Z=ylös)
  //   - scale = S kaikille akseleille
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !selectedDemo) return

    // Poista vanha kartta
    const prev = scene.getObjectByName('mapModel')
    if (prev) scene.remove(prev)
    const prevPlane = scene.getObjectByName('mapPlane')
    if (prevPlane) scene.remove(prevPlane)

    const mapName = selectedDemo.map_name

    // Yritä ladata GLTF ensin
    const loader = new GLTFLoader()
    loader.load(
      `/${mapName}.glb`,
      (gltf) => {
        const root = gltf.scene
        root.name = 'mapModel'

        // Source 2 Viewer bakes CS2→GLTF muunnoksen jokaiseen node-matriisiin:
        //   CS2 X → GLTF Z, CS2 Y → GLTF X, CS2 Z → GLTF Y
        //   skaalaus 0.0254 (CS2 units → metrit)
        // GLTFLoader soveltaa noden matriisit automaattisesti → EI lisärotaatiota tarvita
        //
        // Pelaajat käyttävät c(): CS2 → Three.js * S(0.5)
        // GLTF on metreinä: CS2 * 0.0254
        // Tarvittava lisäskaalaus: S / 0.0254 = 0.5 / 0.0254 ≈ 19.685
        // GLTF node matrix: CS2 Y→GLTF X, CS2 X→GLTF Z, CS2 Z→GLTF Y
        // rotation.y = PI/2 korjaa: GLTF X→Three.js -Z, GLTF Z→Three.js X
        // → täsmää c() muunnoksen kanssa täydellisesti
        // scale = S/0.0254: GLTF on metreinä (×0.0254), pelaajat ×0.5
        // Rotaatio ja skaalaus bäkataan geometriaan matrixWorldin kautta
        root.rotation.set(0, Math.PI / 2, 0)
        root.scale.setScalar(S / 0.0254)
        root.position.set(0, 0, 0)
        root.updateWorldMatrix(true, true)

        // Merge geometriat värin mukaan → muutama draw call kaikkien sijaan
        // Kerää geometriat väriryhmittäin
        const geosByColor = new Map<string, { geos: THREE.BufferGeometry[]; col: THREE.Color }>()

        root.updateWorldMatrix(true, true)
        root.traverse(obj => {
          if (!(obj as THREE.Mesh).isMesh) return
          const mesh = obj as THREE.Mesh
          const orig = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
          let col: THREE.Color
          if (orig && (orig as any).color) {
            col = (orig as any).color.clone()
            const b = col.r * 0.299 + col.g * 0.587 + col.b * 0.114
            if (b < 0.05 || b > 0.95) col = hashColor(obj.name)
          } else {
            col = hashColor(obj.name)
          }

          // Bake world transform geometriaan
          const geo = mesh.geometry.clone()
          geo.applyMatrix4(mesh.matrixWorld)
          // Poista turhat attributet → pienempi muisti
          for (const key of Object.keys(geo.attributes)) {
            if (key !== 'position' && key !== 'normal') geo.deleteAttribute(key)
          }

          const key = col.getHexString()
          if (!geosByColor.has(key)) geosByColor.set(key, { geos: [], col })
          geosByColor.get(key)!.geos.push(geo)
        })

        // Yhdistä ja lisää sceneen — root ei enää tarvita
        const mergedGroup = new THREE.Group()
        mergedGroup.name = 'mapModel'
        geosByColor.forEach(({ geos, col }) => {
          if (!geos.length) return
          try {
            const merged = mergeGeometries(geos, false)
            if (!merged) return
            const mat  = new THREE.MeshLambertMaterial({ color: col, side: THREE.FrontSide })
            const mesh = new THREE.Mesh(merged, mat)
            mesh.frustumCulled = true
            mergedGroup.add(mesh)
          } catch { /* ohita ongelmalliset geometriat */ }
          geos.forEach(g => g.dispose())
        })
        console.log('[GLTF] merged draw calls:', mergedGroup.children.length)

        // Ei offsettia — Source2Viewer exporttaa CS2-koordinaateissa
        // rotation.x=-PI/2 + scale=S tekee saman muunnoksen kuin c() pelaajille
        // → koordinaatit täsmäävät suoraan

        scene.add(mergedGroup)

        // Siirrä kamera mallin päälle
        const box2 = new THREE.Box3().setFromObject(mergedGroup)
        const ctr  = new THREE.Vector3()
        const sz   = new THREE.Vector3()
        box2.getCenter(ctr); box2.getSize(sz)
        console.log('[GLTF] Three.js center:', ctr.x.toFixed(0), ctr.y.toFixed(0), ctr.z.toFixed(0), 'size:', sz.x.toFixed(0), sz.y.toFixed(0), sz.z.toFixed(0))
        if (cameraRef.current && controlsRef.current) {
          controlsRef.current.target.copy(ctr)
          cameraRef.current.position.set(ctr.x, ctr.y + sz.y, ctr.z + sz.z * 0.5)
          controlsRef.current.update()
        }
      },
      undefined,
      () => {
        // Fallback: 2D karttakuva tasona
        const cfg = getMapConfig(mapName)
        if (!cfg) return
        const size = cfg.scale * 1024 * S
        const cx   =  (cfg.posX + cfg.scale * 512) * S
        const cz   = -(cfg.posY + cfg.scale * 512) * S
        const geo  = new THREE.PlaneGeometry(size, size)
        geo.rotateX(-Math.PI / 2)
        new THREE.TextureLoader().load(
          `/${mapName}.png`,
          (tex) => {
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }))
            mesh.position.set(cx, -1, cz)
            mesh.name = 'mapPlane'
            scene.add(mesh)
          },
          undefined,
          () => {
            // Ei karttaa eikä kuvaa — tumma lattia
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a2030, transparent: true, opacity: 0.4 }))
            mesh.position.set(cx, -1, cz)
            mesh.name = 'mapPlane'
            scene.add(mesh)
          }
        )
      }
    )
  }, [selectedDemo])

  // ── Align-mode ref sync ────────────────────────────────────────────────────
  // ── Live-päivitys karttamallin transformille ──────────────────────────────
  useEffect(() => {
    // Merge bakes world transforms → scale/position ei enää toimi per-mesh
    // Käytetään vain mapScale/offset säätimistä jos tarvitaan debug-hienosäätöä
  }, [mapScale, mapOffX, mapOffY, mapOffZ])

  // ── Pre-allokointi: geometriat ja materiaalit luodaan kerran ─────────────
  // Refs pitävät viitteet draw-loopin ulkopuolella jotta ei luoda uudelleen
  const preRef = useRef<{
    playerGeo: THREE.CylinderGeometry
    playerMats: Record<string, THREE.MeshBasicMaterial>
    arrowGeo: THREE.ConeGeometry
    arrowMat: THREE.MeshBasicMaterial
    lineGeos: Record<string, THREE.BufferGeometry>
    lineMats: Record<string, THREE.LineBasicMaterial>
  } | null>(null)

  useEffect(() => {
    // Alusta pre-allokointi Three.js initin jälkeen
    preRef.current = {
      playerGeo:  new THREE.CylinderGeometry(8*S, 8*S, 36*S, 8),
      playerMats: {
        CT:   new THREE.MeshBasicMaterial({ color: CT }),
        T:    new THREE.MeshBasicMaterial({ color: T }),
        DEAD: new THREE.MeshBasicMaterial({ color: DEAD }),
      },
      arrowGeo:  new THREE.ConeGeometry(4*S, 12*S, 6),
      arrowMat:  new THREE.MeshBasicMaterial({ color: 0xffffff }),
      lineGeos:  {},
      lineMats:  {
        CT_shot:   new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.85 }),
        T_shot:    new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.85 }),
        trail_CT:  new THREE.LineBasicMaterial({ color: CT,       transparent: true, opacity: 0.4 }),
        trail_T:   new THREE.LineBasicMaterial({ color: T,        transparent: true, opacity: 0.4 }),
        kill_hs:   new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.85 }),
        kill_norm: new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85 }),
      },
    }
    return () => {
      if (!preRef.current) return
      preRef.current.playerGeo.dispose()
      preRef.current.arrowGeo.dispose()
    }
  }, [])

  // ── Piirrä kaikki data ─────────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    const pre   = preRef.current
    if (!scene || !positions.length || !pre) return

    const dynGroup = scene.getObjectByName('dynamic') as THREE.Group
    if (!dynGroup) return
    dynGroup.clear()
    const add = (o: THREE.Object3D) => dynGroup.add(o)

    const tickIdx        = tickToIndex.get(localTick) ?? 0
    const nextTick       = allTicks[tickIdx + 1] ?? localTick
    const roundInfo      = rounds.find(r => r.round_num === currentRound)
    const roundStartTick = roundInfo?.start_tick ?? (allTicks[0] ?? 0)

    const posIndex: Record<string, { cur?: any; next?: any }> = {}
    for (const p of positions) {
      const sid = String(p.steam_id)
      if      (p.tick === localTick) (posIndex[sid] ??= {}).cur  = p
      else if (p.tick === nextTick)  (posIndex[sid] ??= {}).next = p
    }

    // ── Kerää kaikki linjat arrays → yksi LineSegments per tyyppi ─────────────
    const linePoints: Record<string, number[]> = {
      CT_shot: [], T_shot: [], trail_CT: [], trail_T: [], kill_hs: [], kill_norm: []
    }
    const pushLine = (key: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      linePoints[key]?.push(ax,ay,az, bx,by,bz)
    }

    // ── Pelaajien reitit ──────────────────────────────────────────────────────
    if (L.playerTrails) {
      const trailSet = new Set(allTicks.slice(Math.max(0, tickIdx - TRAIL_TICKS), tickIdx + 1))
      const byPlayer: Record<string, typeof positions> = {}
      for (const [sid, track] of Object.entries(posBySteam)) {
        const filtered = track.filter(p => trailSet.has(p.tick) && (p.is_alive === true || (p.is_alive as any) === 1))
        if (filtered.length) byPlayer[sid] = filtered
      }
      for (const [sid, trail] of Object.entries(byPlayer)) {
        if (trail.length < 2) continue
        const key    = teamMap[sid] === 'CT' ? 'trail_CT' : 'trail_T'
        for (let i = 1; i < trail.length; i++) {
          const a = c(trail[i-1].x, trail[i-1].y, trail[i-1].z)
          const b = c(trail[i].x,   trail[i].y,   trail[i].z)
          pushLine(key, a.x,a.y,a.z, b.x,b.y,b.z)
        }
      }
    }

    // ── Savut ─────────────────────────────────────────────────────────────────
    if (L.smokes) {
      smokeEffects
        .filter(s => localTick >= s.start_tick && localTick <= s.end_tick)
        .forEach(s => {
          const bloom  = Math.min(1, (localTick - s.start_tick) / BLOOM_TICKS)
          const r      = 144 * S * bloom
          const origin = c(s.x, s.y, s.z)
          origin.y    += r * 0.5
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(r, 10, 8),
            new THREE.MeshPhongMaterial({ color: 0x6b7280, transparent: true, opacity: 0.55, depthWrite: false })
          )
          mesh.position.copy(origin)
          add(mesh)
        })
    }

    // ── Kranaatit ─────────────────────────────────────────────────────────────
    if (L.grenades) {
      grenades.forEach(gr => {
        if (gr.tick_thrown > localTick) return
        const color     = GREN[gr.grenade_type] ?? 0xffffff
        const allTraj   = trajByGrenade[gr.id] ?? []
        const traj      = allTraj.filter(pt => pt.tick <= localTick)
        const isMolotov = gr.grenade_type === 'molotov' || gr.grenade_type === 'incgrenade'
        const isHE      = gr.grenade_type === 'hegrenade'
        const isFlash   = gr.grenade_type === 'flashbang'
        const isSmoke   = gr.grenade_type === 'smokegrenade'
        const maxFlight: Record<string, number> = { hegrenade:448, flashbang:384, smokegrenade:640, molotov:512, incgrenade:512, decoy:768 }
        const rawDet    = gr.tick_detonated
        const saneTick  = rawDet != null && rawDet < gr.tick_thrown + (maxFlight[gr.grenade_type] ?? 640) ? rawDet : null
        const infernoStart = isMolotov ? (infernoFires.find(fp => fp.grenade_id === gr.id)?.tick ?? null) : null
        const detTick   = saneTick ?? (allTraj.length ? allTraj[allTraj.length-1].tick : null) ?? infernoStart
        const detonated = detTick != null && localTick >= detTick
        const age       = detonated ? localTick - detTick! : 0
        if (isHE && detonated && age > BLAST_TICKS) return
        if (isFlash && detonated && age > BLAST_TICKS) return
        if (isMolotov && detonated && age > MOLOTOV_TICKS) return
        if (isSmoke && detonated) return

        // Trajektorilinja
        if (traj.length >= 2 && (!detonated || age < BLAST_TICKS)) {
          for (let i = 1; i < traj.length; i++) {
            const a = c(traj[i-1].x, traj[i-1].y, traj[i-1].z)
            const b = c(traj[i].x, traj[i].y, traj[i].z)
            pushLine('kill_norm', a.x,a.y,a.z, b.x,b.y,b.z)
          }
        }

        if (!detonated) {
          const last = traj[traj.length-1]
          if (last) {
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(3*S,6,5),
              new THREE.MeshBasicMaterial({ color }))
            mesh.position.copy(c(last.x,last.y,last.z))
            add(mesh)
          }
        } else {
          const dx = gr.detonate_x ?? (traj.length ? traj[traj.length-1].x : gr.throw_x)
          const dy = gr.detonate_y ?? (traj.length ? traj[traj.length-1].y : gr.throw_y)
          const dz = gr.detonate_z ?? (traj.length ? traj[traj.length-1].z : 0)
          const pos = c(dx,dy,dz)
          if ((isHE||isFlash) && age < BLAST_TICKS) {
            const alpha = 1 - age/BLAST_TICKS
            const r = (isHE ? 18+20*(age/BLAST_TICKS) : 14*(1+age/BLAST_TICKS)) * S
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(r,10,7),
              new THREE.MeshBasicMaterial({ color: isHE?0xff4400:0xffffee, transparent:true, opacity:alpha*0.4 }))
            mesh.position.copy(pos); add(mesh)
          }
          if (isMolotov && age < MOLOTOV_TICKS) {
            const fires = infernoFires.filter(fp => fp.grenade_id === gr.id && fp.tick <= localTick)
            const latest = fires.length ? Math.max(...fires.map(f=>f.tick)) : null
            const pts = latest ? fires.filter(f=>f.tick===latest) : []
            const flicker = 0.75+0.25*Math.sin(localTick*0.5)
            pts.forEach(fp => {
              const p = c(fp.x,fp.y,0)
              const flame = new THREE.Mesh(new THREE.ConeGeometry(4*S,10*S,5),
                new THREE.MeshBasicMaterial({ color:0xea580c, transparent:true, opacity:0.6*flicker }))
              flame.position.set(p.x, p.y+5*S, p.z); add(flame)
            })
          }
        }
      })
    }

    // ── Pommi ─────────────────────────────────────────────────────────────────
    if (L.bomb && bombEvents?.length) {
      const past    = bombEvents.filter(b => b.tick <= localTick)
      const plant   = [...past].reverse().find(b => b.event_type === 'plant')
      const explode = [...past].reverse().find(b => b.event_type === 'explode')
      const defuse  = [...past].reverse().find(b => b.event_type === 'defuse')
      if (plant) {
        const pos = c(plant.x, plant.y, plant.z ?? 0)
        if (explode) {
          const spr = makeTextSprite('BOOM', 0xff4444)
          spr.position.set(pos.x, pos.y+14*S, pos.z); add(spr)
        } else if (defuse) {
          const spr = makeTextSprite('DEFUSED', 0x4488ff)
          spr.position.set(pos.x, pos.y+12*S, pos.z); add(spr)
        } else {
          const elapsed  = (localTick - plant.tick) / TICKRATE
          const secsLeft = Math.max(0, BOMB_TIMER_S - elapsed)
          const critical = secsLeft < 10
          const pulse    = critical ? (0.7+0.3*Math.sin(localTick/5)) : 1.0
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(4*S,7,6),
            new THREE.MeshBasicMaterial({ color:0xff4400 }))
          mesh.position.copy(pos); mesh.scale.setScalar(pulse); add(mesh)
          const spr = makeTextSprite(secsLeft.toFixed(1)+'s'+(plant.site?` [${plant.site}]`:''), critical?0xff2222:0xffcc00)
          spr.position.set(pos.x, pos.y+16*S, pos.z); add(spr)
        }
      }
    }

    // ── Tappomerkit → linjat ──────────────────────────────────────────────────
    if (L.kills) {
      kills.filter(k => k.tick >= roundStartTick && k.tick <= localTick).forEach(k => {
        const pos = c(k.victim_x, k.victim_y, 0)
        const key = k.headshot ? 'kill_hs' : 'kill_norm'
        const sz  = (k.headshot ? 6 : 5) * S
        pushLine(key, pos.x-sz,pos.y,pos.z-sz, pos.x+sz,pos.y,pos.z+sz)
        pushLine(key, pos.x+sz,pos.y,pos.z-sz, pos.x-sz,pos.y,pos.z+sz)
        if (L.killLines && k.attacker_x && k.attacker_y) {
          const a = c(k.attacker_x, k.attacker_y, 0)
          pushLine('kill_norm', a.x,a.y,a.z, pos.x,pos.y,pos.z)
        }
      })
    }

    // ── Laukaukset → linjat ───────────────────────────────────────────────────
    if (L.shots) {
      shots
        .filter(s => s.tick >= roundStartTick && s.tick <= localTick && localTick-s.tick <= SHOT_FADE_TICKS)
        .forEach(shot => {
          const team  = teamMap[String(shot.steam_id)]
          const key   = team === 'CT' ? 'CT_shot' : 'T_shot'
          const shooterPos = findPosAtTick(String(shot.steam_id), shot.tick)
          const eyeH  = (Boolean(shooterPos?.is_ducking) ? EYE_CROUCH : EYE_HEIGHT) * S
          const from  = c(shot.x, shot.y, shot.z); from.y += eyeH
          const to    = from.clone().add(shotDir(shot.yaw??0, shot.pitch??0, 500*S))
          pushLine(key, from.x,from.y,from.z, to.x,to.y,to.z)
        })
    }

    // ── Hitmarks (damage impact points in 3D) ───────────────────────────────
    if (L.shots) {
      damage
        .filter(d => d.tick >= roundStartTick && d.tick <= localTick && localTick - d.tick <= HITMARK_FADE_TICKS)
        .forEach(d => {
          const victimPos = findPosAtTick(String(d.victim_steam_id), d.tick)
          if (!victimPos) return
          const pos = c(victimPos.x, victimPos.y, victimPos.z)
          const age = localTick - d.tick
          const alpha = 1 - age / HITMARK_FADE_TICKS
          const size = (4 + (d.damage ?? 0) * 0.04) * S
          const mat = new THREE.MeshBasicMaterial({
            color: d.damage && d.damage >= 80 ? 0xef4444 : 0xfff59d,
            transparent: true,
            opacity: Math.max(0.15, alpha),
            depthWrite: false,
          })
          const a = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.15), mat)
          const b = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.15), mat)
          a.position.set(pos.x, pos.y + (EYE_HEIGHT * 0.7 * S), pos.z)
          b.position.copy(a.position)
          a.lookAt(cameraRef.current?.position ?? new THREE.Vector3())
          b.lookAt(cameraRef.current?.position ?? new THREE.Vector3())
          b.rotateZ(Math.PI / 2)
          add(a)
          add(b)
        })
    }

    // Rakenna LineSegments kerätystä datasta
    Object.entries(linePoints).forEach(([key, pts]) => {
      if (!pts.length) return
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      const mat = pre.lineMats[key]
      add(new THREE.LineSegments(geo, mat))
    })

    // ── Pelaajat: yksinkertaiset sylinterit + suuntanuoli ─────────────────────
    if (L.players) {
      Object.entries(posIndex).forEach(([steamId, { cur: pA, next: pB }]) => {
        if (!pA) return
        const alive     = pA.is_alive === true || (pA.is_alive as any) === 1
        const crouching = Boolean(pA.is_ducking)
        const pN = pB ?? pA
        const t  = tickProgress ?? 0
        const wx = pA.x + (pN.x-pA.x)*t
        const wy = pA.y + (pN.y-pA.y)*t
        const wz = pA.z + (pN.z-pA.z)*t
        let dy = pN.yaw - pA.yaw
        if (dy > 180) dy -= 360; if (dy < -180) dy += 360
        const yaw    = pA.yaw + dy*t
        const team   = teamMap[steamId] ?? 'CT'
        const matKey = alive ? (team === 'CT' ? 'CT' : 'T') : 'DEAD'
        const origin = c(wx, wy, wz)
        const height = (crouching ? 36 : 72) * S

        // Player-like model: torso + head + legs (still lightweight)
        const bodyGroup = new THREE.Group()
        const torsoH = (crouching ? 22 : 30) * S
        const legH = (crouching ? 12 : 22) * S
        const legGap = 2.2 * S

        const torso = new THREE.Mesh(
          new THREE.CapsuleGeometry(6.5 * S, torsoH, 3, 6),
          pre.playerMats[matKey]
        )
        torso.position.set(0, legH + torsoH * 0.5, 0)
        bodyGroup.add(torso)

        const head = new THREE.Mesh(
          new THREE.SphereGeometry(4.2 * S, 8, 6),
          new THREE.MeshBasicMaterial({ color: alive ? 0xe5e7eb : 0x6b7280 })
        )
        head.position.set(0, legH + torsoH + 5.5 * S, 0)
        bodyGroup.add(head)

        const legMat = new THREE.MeshBasicMaterial({ color: alive ? 0x1f2937 : 0x3f3f46 })
        const legL = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * S, 2.2 * S, legH, 6), legMat)
        const legR = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * S, 2.2 * S, legH, 6), legMat)
        legL.position.set(-legGap, legH * 0.5, 0)
        legR.position.set(legGap, legH * 0.5, 0)
        bodyGroup.add(legL)
        bodyGroup.add(legR)

        bodyGroup.position.set(origin.x, origin.y, origin.z)
        add(bodyGroup)

        if (alive) {
          // Suuntanuoli — käytetään quaternionia jotta vastaa shotDir-suuntaa
          const eyeY   = (crouching ? EYE_CROUCH : EYE_HEIGHT) * S
          const yawRad = yaw * Math.PI / 180
          // Sama kaava kuin shotDir pitch=0: (cos(y), 0, -sin(y))
          const fwd  = new THREE.Vector3(Math.cos(yawRad), 0, -Math.sin(yawRad)).normalize()
          const arrow = new THREE.Mesh(pre.arrowGeo, pre.arrowMat)
          arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fwd)
          arrow.position.set(origin.x, origin.y + eyeY, origin.z)
          add(arrow)

          // HP-palkki (2 linjaa)
          const hpFrac = Math.max(0, pA.health??100)/100
          const hpKey  = hpFrac > 0.5 ? 'trail_CT' : 'kill_norm'
          const r = 12*S
          pushLine(hpKey, origin.x-r,origin.y+height+2*S,origin.z, origin.x-r+2*r*hpFrac,origin.y+height+2*S,origin.z)
        }

        // Nimilappu
        if (alive && L.playerLabels) {
          const name = nameMap[steamId] ?? steamId.slice(-5)
          const lbl  = makeLabel(`${name.slice(0,12)}  ${pA.health}hp`, alive?(team==='CT'?CT:T):DEAD, crouching)
          lbl.position.set(origin.x, origin.y+(crouching?36:72)*S+5*S, origin.z)
          add(lbl)
        }
      })
    }

  }, [localTick, tickProgress, currentRound, L, selectedDemo, positions, kills, grenades,
      grenadeTrajectories, smokeEffects, bombEvents, flashEvents, infernoFires, shots,
      allTicks, players, rounds, teamMap, nameMap, tickToIndex, posBySteam, trajByGrenade, damage])

  // ── Playback ───────────────────────────────────────────────────────────────
  useEffect(() => { playRef.current = playing }, [playing])

  useEffect(() => {
    if (!playing) return
    let idx = Math.max(0, allTicks.findIndex(t => t >= localTick))
    const iv = setInterval(() => {
      if (!playRef.current) { clearInterval(iv); return }
      idx++
      if (idx >= allTicks.length) { setPlaying(false); clearInterval(iv); return }
      setLocalTick(allTicks[idx])
    }, 1000 / TICKRATE)
    return () => clearInterval(iv)
  }, [playing])

  // Koko round aikajanana
  const roundStart = allTicks[0] ?? 0
  const roundEnd   = allTicks[allTicks.length - 1] ?? 1
  const roundRange = roundEnd - roundStart || 1
  const curI       = allTicks.findIndex(t => t >= localTick)

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:'92vw', height:'88vh', background:'#0a0c12', borderRadius:16, border:'1px solid #1e2130', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:'1px solid #1e2130', background:'#111420', flexShrink:0, flexWrap:'wrap' }}>
          <div style={{ background:'#f97316', borderRadius:6, padding:'2px 9px', fontSize:11, fontWeight:800, color:'#fff' }}>RS 3D</div>
          <span style={{ fontSize:10, color:'#4b5563', fontFamily:'monospace' }}>
            tick {localTick.toLocaleString()}
          </span>
          <span style={{ fontSize:10, color:'#6b7280' }}>
            {((localTick - roundStart) / TICKRATE).toFixed(1)}s / {((roundEnd - roundStart) / TICKRATE).toFixed(1)}s
          </span>
          <button onClick={() => setLocalTick(currentTick)}
            style={{ padding:'2px 9px', borderRadius:6, fontSize:10, cursor:'pointer', background:'rgba(91,156,246,0.12)', color:'#5b9cf6', border:'1px solid rgba(91,156,246,0.25)' }}>
            ⟳ Sync 2D
          </button>
          <div style={{ marginLeft:'auto', display:'flex', gap:12, fontSize:10, flexWrap:'wrap' }}>
            <span style={{ color:'#5b9cf6' }}>● CT</span>
            <span style={{ color:'#f97316' }}>● T</span>
            <span style={{ color:'#93c5fd' }}>— CT laukaus</span>
            <span style={{ color:'#fb923c' }}>— T laukaus</span>
            <span style={{ color:'#ef4444' }}>● HS</span>
            <span style={{ color:'#fbbf24' }}>□ kyykky</span>
            <span style={{ color:'#4b5563', borderLeft:'1px solid #2a2f45', paddingLeft:10 }}>WASD · Q/E ylös/alas · rulla zoom</span>
          </div>
          <button
            onClick={() => { setAlignMode(v => !v); setAlignPts([]) }}
            style={{ padding:'2px 9px', borderRadius:6, fontSize:10, cursor:'pointer',
              background: alignMode ? 'rgba(251,191,36,0.2)' : 'transparent',
              color: alignMode ? '#fbbf24' : '#6b7280',
              border:`1px solid ${alignMode ? 'rgba(251,191,36,0.4)' : 'rgba(91,156,246,0.25)'}` }}>
            📍 Align
          </button>
          <button
            onClick={() => setShowMapControls(v => !v)}
            style={{ padding:'2px 9px', borderRadius:6, fontSize:10, cursor:'pointer',
              background: showMapControls ? 'rgba(91,156,246,0.2)' : 'transparent',
              color: showMapControls ? '#5b9cf6' : '#6b7280',
              border:'1px solid rgba(91,156,246,0.25)' }}>
            ⚙ Kartta
          </button>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Karttamallin säätöpaneeli */}
        {showMapControls && (
          <div style={{ padding:'8px 14px', borderBottom:'1px solid #1e2130', background:'#0d1020', display:'flex', gap:16, alignItems:'center', flexWrap:'wrap', fontSize:10, color:'#9ca3af' }}>
            {([
              ['Scale', mapScale, setMapScale, 0.01, 0.01, 5,    0.01],
              ['X',     mapOffX,  setMapOffX,  10,   -5000, 5000, 1],
              ['Y',     mapOffY,  setMapOffY,  1,    -500,  500,  1],
              ['Z',     mapOffZ,  setMapOffZ,  10,   -5000, 5000, 1],
            ] as [string, number, (v:number)=>void, number, number, number, number][]).map(([label, val, setter, step, min, max]) => (
              <label key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ minWidth:14, color:'#5b9cf6' }}>{label}</span>
                <input type="range" min={min} max={max} step={step} value={val}
                  onChange={e => setter(Number(e.target.value))}
                  style={{ width:110 }} />
                <span style={{ fontFamily:'monospace', minWidth:50, color:'#e2e8f0' }}>
                  {val.toFixed(label === 'Scale' ? 3 : 0)}
                </span>
                <button onClick={() => setter(label === 'Scale' ? S : 0)}
                  style={{ fontSize:9, padding:'1px 5px', borderRadius:4, cursor:'pointer', background:'#1e2130', border:'1px solid #2a3045', color:'#6b7280' }}>
                  ↺
                </button>
              </label>
            ))}
          </div>
        )}

        {/* Spawn-point alignment paneeli */}
        {alignMode && (
          <div style={{ padding:'8px 14px', borderBottom:'1px solid #1e2130', background:'#0a1020', fontSize:10, color:'#9ca3af', pointerEvents:'auto' }}>
            <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ color:'#fbbf24', fontWeight:700 }}>📍 Align</span>
              {[0,1].map(i => {
                const pt = alignPts[i]
                const waiting2d = alignPts.filter(p=>p.step==='done').length === i && (!pt || pt.step === '3d')
                const waiting3d = pt?.step === '2d'
                return (
                  <div key={i} style={{ display:'flex', gap:5, alignItems:'center', padding:'3px 8px', borderRadius:5,
                    background: pt?.step==='done' ? '#142a1a' : waiting2d||waiting3d ? '#1a2535' : '#111827',
                    border:`1px solid ${pt?.step==='done' ? '#16a34a' : waiting2d||waiting3d ? '#fbbf24' : '#1e2130'}` }}>
                    <span style={{ fontWeight:700, color:'#5b9cf6' }}>P{i+1}</span>
                    {!pt && <span style={{ color:'#374151' }}>odottaa</span>}
                    {pt?.step==='2d' && <span style={{ color:'#fbbf24' }}>2D({pt.cs2x.toFixed(0)},{pt.cs2y.toFixed(0)}) → klikkaa 3D</span>}
                    {pt?.step==='done' && <span style={{ color:'#4ade80' }}>✓ 2D+3D</span>}
                  </div>
                )
              })}
              {alignPts.filter(p=>p.step==='done').length===2 && (
                <button onClick={() => {
                  const p0=alignPts[0], p1=alignPts[1]
                  const S2=0.5
                  const t0=new THREE.Vector3(p0.cs2x*S2, 0, -p0.cs2y*S2)
                  const t1=new THREE.Vector3(p1.cs2x*S2, 0, -p1.cs2y*S2)
                  const m0=new THREE.Vector3(p0.mx, 0, p0.mz)
                  const m1=new THREE.Vector3(p1.mx, 0, p1.mz)
                  const dist = m0.distanceTo(m1)
                  if (dist<0.001) return
                  const scale = t0.distanceTo(t1) / dist
                  const offX = t0.x - m0.x*scale
                  const offZ = t0.z - m0.z*scale
                  const model = sceneRef.current?.getObjectByName('mapModel')
                  let offY = 0
                  if (model) {
                    model.scale.setScalar(scale); model.position.set(offX,0,offZ)
                    const box=new THREE.Box3().setFromObject(model); offY=-box.min.y
                  }
                  setMapScale(scale); setMapOffX(offX); setMapOffY(offY); setMapOffZ(offZ)
                  setAlignMode(false); setAlignPts([])
                }} style={{ padding:'3px 12px', borderRadius:5, cursor:'pointer', background:'#16a34a', border:'none', color:'#fff', fontWeight:700 }}>
                  ✓ Laske
                </button>
              )}
              <button onClick={() => { setAlignMode(false); setAlignPts([]) }}
                style={{ marginLeft:'auto', padding:'2px 8px', borderRadius:4, cursor:'pointer', background:'#1e2130', border:'1px solid #2a3045', color:'#6b7280', fontSize:9 }}>
                Peruuta
              </button>
            </div>
            <div style={{ marginTop:5, color:'#4b5563' }}>
              {alignPts.length===0 && 'Klikkaa minimapilta P1'}
              {alignPts.length===1 && alignPts[0].step==='2d' && 'Klikkaa 3D-mallilta sama piste kuin minimapilla'}
              {alignPts.length===1 && alignPts[0].step==='done' && 'Klikkaa minimapilta P2 (mahdollisimman kaukana P1:stä)'}
              {alignPts.length===2 && alignPts[1].step==='2d' && 'Klikkaa 3D-mallilta P2'}
            </div>
          </div>
        )}

                {/* Canvas + KillFeed overlay */}
        <div style={{ flex:1, overflow:'hidden', position:'relative', cursor: alignMode ? 'crosshair' : 'grab' }}>
          {/* Three.js canvas — kuuntelee 3D-klikkauksia align-tilassa */}
          <div ref={mountRef} style={{ width:'100%', height:'100%' }}
            onClick={e => {
              if (!alignMode) return
              // Odotamme 3D-klikkausta vain jos viimeisin piste odottaa 3D:tä
              const last = alignPts[alignPts.length-1]
              if (!last || last.step !== '2d') return
              const scene = sceneRef.current
              const camera = cameraRef.current
              if (!scene || !camera) return
              const el   = e.currentTarget
              const rect = el.getBoundingClientRect()
              const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width)  * 2 - 1,
               -((e.clientY - rect.top)  / rect.height) * 2 + 1,
              )
              const ray = new THREE.Raycaster()
              ray.setFromCamera(mouse, camera)
              const model = scene.getObjectByName('mapModel')
              if (!model) return
              const hits = ray.intersectObject(model, true)
              if (!hits.length) return
              const pt = hits[0].point
              setAlignPts(prev => prev.map((p,i) =>
                i===prev.length-1 ? {...p, mx:pt.x, mz:pt.z, step:'done'} : p
              ))
            }}
          />
          <KillFeed />

          {/* Minimap align-tilassa — oikeassa alakulmassa, ei blokkaa 3D-canvasia */}
          {alignMode && selectedDemo && (
            <div style={{ position:'absolute', bottom:16, right:16, pointerEvents:'auto' }}>
              <AlignMinimap
                mapName={selectedDemo.map_name}
                alignPts={alignPts}
                waiting2d={!alignPts.length || alignPts[alignPts.length-1].step==='done'}
                onClickCs2={(cs2x, cs2y) => {
                  if (alignPts.length >= 2) return
                  const last = alignPts[alignPts.length-1]
                  if (last && last.step !== 'done') return
                  setAlignPts(prev => [...prev, {cs2x, cs2y, mx:0, mz:0, step:'2d'}])
                }}
              />
            </div>
          )}
        </div>

        {/* Kelluva pelaajapaneeli — vasemmalla, rajattu canvaksen korkeuteen */}
        <div style={{
          position:'absolute', top:10, left:10, bottom:10, zIndex:60,
          background:'rgba(13,15,20,0.92)', border:'1px solid #1e2130',
          borderRadius:12, overflow:'hidden',
          width:148, display:'flex', flexDirection:'column',
          backdropFilter:'blur(6px)', pointerEvents:'auto',
        }}>
          <div style={{ overflowY:'auto', flex:1 }}>
          {(['CT','T'] as const).map(side => {
            const color = side === 'CT' ? '#5b9cf6' : '#f97316'
            const sidePlayers = players.filter(p => p.team_start === side)
            return (
              <div key={side}>
                <div style={{ padding:'4px 10px', fontSize:9, fontWeight:700, letterSpacing:'.7px', color, borderLeft:`2px solid ${color}`, borderTop: side==='T' ? '1px solid #1e2130' : 'none' }}>
                  {side}
                </div>
                {sidePlayers.map(player => {
                  const pos   = positions.find(p => String(p.steam_id) === String(player.steam_id) && p.tick === localTick)
                  const alive = pos?.is_alive !== false
                  const hp    = pos?.health ?? 0
                  return (
                    <button key={player.steam_id}
                      onClick={() => {
                        if (!pos || !cameraRef.current || !controlsRef.current) return
                        const target = c(pos.x, pos.y, pos.z)
                        const eyeH   = (pos.is_ducking ? EYE_CROUCH : EYE_HEIGHT) * S
                        const eyePos = new THREE.Vector3(target.x, target.y + eyeH, target.z)

                        // Laske kameran POV-sijainti: silmien takana yaw-suunnassa
                        const yawRad = pos.yaw * Math.PI / 180
                        const behindDist = 60 * S
                        const camPos = new THREE.Vector3(
                          eyePos.x - Math.cos(yawRad) * behindDist,
                          eyePos.y + 20 * S,
                          eyePos.z + Math.sin(yawRad) * behindDist
                        )

                        // Lennätä kamera pehmeästi
                        const startPos    = cameraRef.current.position.clone()
                        const startTarget = controlsRef.current.target.clone()
                        const duration    = 600  // ms
                        const startTime   = performance.now()

                        const fly = (now: number) => {
                          const t = Math.min(1, (now - startTime) / duration)
                          const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t  // easeInOut
                          cameraRef.current!.position.lerpVectors(startPos, camPos, ease)
                          controlsRef.current!.target.lerpVectors(startTarget, eyePos, ease)
                          controlsRef.current!.update()
                          if (t < 1) requestAnimationFrame(fly)
                        }
                        requestAnimationFrame(fly)
                      }}
                      style={{
                        width:'100%', display:'flex', alignItems:'center', gap:7,
                        padding:'5px 10px', background:'transparent', border:'none',
                        cursor: alive ? 'pointer' : 'default',
                        opacity: alive ? 1 : 0.35,
                        transition:'background .1s',
                      }}
                      onMouseEnter={e => { if (alive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >
                      {/* HP-palkki */}
                      <div style={{ width:3, height:28, background:'#1e2130', borderRadius:2, overflow:'hidden', flexShrink:0 }}>
                        <div style={{
                          height:`${hp}%`, width:'100%', borderRadius:2,
                          background: hp > 70 ? '#22c55e' : hp > 35 ? '#f59e0b' : '#ef4444',
                          marginTop:`${100-hp}%`,
                        }}/>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, fontWeight:600, color: alive ? '#e2e8f0' : '#4b5563', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {player.name}
                        </div>
                        {alive && (
                          <div style={{ fontSize:8, color: hp > 70 ? '#22c55e' : hp > 35 ? '#f59e0b' : '#ef4444', fontVariantNumeric:'tabular-nums' }}>
                            {hp}hp
                          </div>
                        )}
                      </div>
                      {alive && <span style={{ fontSize:9, color:'#2a2f45' }}>→</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
          </div>
        </div>

        {/* Playbar */}
        <div style={{ padding:'8px 14px', borderTop:'1px solid #1e2130', background:'#111420', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          <button onClick={() => setLocalTick(allTicks[0])}
            style={{ width:24, height:24, borderRadius:6, cursor:'pointer', background:'transparent', border:'1px solid #2a2f45', color:'#6b7280', fontSize:11 }}>⏮</button>
          <button onClick={() => setPlaying(v => !v)}
            style={{ width:30, height:30, borderRadius:8, cursor:'pointer', background:'#f97316', border:'none', color:'#fff', fontSize:13 }}>
            {playing ? '⏸' : '▶'}
          </button>
          <span style={{ fontSize:10, color:'#6b7280', fontFamily:'monospace', minWidth:36 }}>
            {((localTick - roundStart) / TICKRATE).toFixed(1)}s
          </span>
          <div style={{ flex:1, height:6, background:'#1e2130', borderRadius:3, position:'relative', cursor:'pointer' }}
            onClick={e => {
              const r   = e.currentTarget.getBoundingClientRect()
              const idx = Math.round(((e.clientX - r.left) / r.width) * (allTicks.length - 1))
              if (allTicks[idx]) setLocalTick(allTicks[idx])
            }}>
            <div style={{ position:'absolute', top:0, height:'100%', borderRadius:3, background:'#f97316',
              width:`${allTicks.length > 1 ? (curI / (allTicks.length-1)) * 100 : 0}%` }} />
            {shots.map((s, i) => {
              const pct = (s.tick - roundStart) / roundRange
              if (pct < 0 || pct > 1) return null
              return <div key={i} style={{ position:'absolute', top:0, bottom:0, left:`${pct*100}%`, width:2,
                background: teamMap[String(s.steam_id)] === 'CT' ? '#93c5fd' : '#fb923c', opacity:.5, borderRadius:1 }} />
            })}
            {kills.map((k, i) => {
              const pct = (k.tick - roundStart) / roundRange
              if (pct < 0 || pct > 1) return null
              return <div key={i} title={`${k.attacker_name}→${k.victim_name}`} style={{
                position:'absolute', top:-3, bottom:-3, left:`${pct*100}%`,
                width:3, background: k.headshot ? '#ef4444' : '#f97316', borderRadius:1 }} />
            })}
          </div>
          <span style={{ fontSize:10, color:'#6b7280', fontFamily:'monospace', minWidth:36, textAlign:'right' }}>
            {((roundEnd - roundStart) / TICKRATE).toFixed(1)}s
          </span>
          <span style={{ fontSize:10, color:'#9ca3af' }}>
            {shots.length} laukausta · {kills.length} tappoa
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Align Minimap ────────────────────────────────────────────────────────────
interface AlignMinimapProps {
  mapName: string
  alignPts: {cs2x:number,cs2y:number,mx:number,mz:number,step:'2d'|'3d'|'done'}[]
  waiting2d: boolean
  onClickCs2: (x: number, y: number) => void
}

function AlignMinimap({ mapName, alignPts, waiting2d, onClickCs2 }: AlignMinimapProps) {
  const SIZE = 260
  const cfg  = getMapConfig(mapName)

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!waiting2d || !cfg) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const px   = (e.clientX - rect.left) / SIZE
    const py   = (e.clientY - rect.top)  / SIZE
    onClickCs2(px * cfg.scale * 1024 + cfg.posX, py * cfg.scale * 1024 + cfg.posY)
  }

  const toXY = (cs2x: number, cs2y: number) => {
    if (!cfg) return null
    return {
      x: (cs2x - cfg.posX) / (cfg.scale * 1024) * SIZE,
      y: (cs2y - cfg.posY) / (cfg.scale * 1024) * SIZE,
    }
  }

  return (
    <div
      style={{ width:SIZE, height:SIZE, border:`2px solid ${waiting2d?'#fbbf24':'#3d5a8a'}`,
        borderRadius:8, overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.8)',
        cursor: waiting2d ? 'crosshair' : 'default', userSelect:'none' }}
      onClick={handleClick}
    >
      <img src={`/${mapName}.png`} style={{ width:SIZE, height:SIZE, display:'block' }} draggable={false} />
      <svg style={{ position:'absolute', inset:0, width:SIZE, height:SIZE, pointerEvents:'none' }}>
        {alignPts.map((pt, i) => {
          const pos = toXY(pt.cs2x, pt.cs2y)
          if (!pos) return null
          const col = pt.step==='done' ? '#4ade80' : '#fbbf24'
          return (
            <g key={i}>
              <circle cx={pos.x} cy={pos.y} r={8} fill={col} fillOpacity={0.25} stroke={col} strokeWidth={2}/>
              <circle cx={pos.x} cy={pos.y} r={2.5} fill={col}/>
              <text x={pos.x+10} y={pos.y+4} fill={col} fontSize={11} fontWeight="bold"
                stroke="#000" strokeWidth={2.5} paintOrder="stroke">P{i+1}</text>
            </g>
          )
        })}
      </svg>
      <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,0.75)',
        color: waiting2d?'#fbbf24':'#9ca3af', fontSize:10, padding:'3px 6px', textAlign:'center', fontWeight:700 }}>
        {waiting2d ? `Klikkaa P${alignPts.length+1}` : 'Klikkaa 3D-mallilta →'}
      </div>
    </div>
  )
}

// ── Värigeneraattori kartan mesheille ────────────────────────────────────────
// Tuottaa deterministisen värin mesh-nimen perusteella
function hashColor(name: string): THREE.Color {
  let h = 0
  for (let i = 0; i < name.length; i++) h = Math.imul(31, h) + name.charCodeAt(i) | 0
  // Rajataan earth-tone-palettiin: tummanharmaa → ruskea → beige
  const hue = ((h & 0xff) / 255) * 60 + 20        // 20–80° (keltainen/ruskea/oranssi)
  const sat = ((h >> 8 & 0xff) / 255) * 0.3 + 0.1  // 10–40% saturaatio
  const lig = ((h >> 16 & 0xff) / 255) * 0.25 + 0.2 // 20–45% kirkkaus
  return new THREE.Color().setHSL(hue / 360, sat, lig)
}

// ── Low-poly sotilasmalli ─────────────────────────────────────────────────────
function buildSoldier(color: number, alive: boolean, crouching: boolean): THREE.Group {
  const g     = new THREE.Group()
  const alpha = alive ? 0.85 : 0.2
  const wire  = (col: number, op = alpha) => new THREE.MeshPhongMaterial({ color: col, wireframe: true, transparent: true, opacity: op })
  const solid = (col: number, op = alpha * 0.6) => new THREE.MeshPhongMaterial({ color, transparent: true, opacity: op })
  const u     = (n: number) => n * S

  if (!crouching) {
    addCapsule(g, wire(color), u(5), u(22), 0, u(11), 0)
    addCapsule(g, wire(color), u(5), u(22), u(-8), u(11), 0)
    addBox(g, wire(color), u(18), u(10), u(12), 0, u(28), 0)
    addBox(g, wire(color), u(16), u(14), u(12), 0, u(41), 0)
    addBox(g, wire(color), u(20), u(12), u(14), 0, u(53), 0)
    addBox(g, wire(color), u(28), u(8),  u(12), 0, u(59), 0)
    addCylinder(g, wire(color), u(4), u(4), u(6), 0, u(64), 0)
    addHead(g, wire(color), solid(color, alpha * 0.3), u(8), u(10), u(8), 0, u(70), 0)
    addCapsule(g, wire(color), u(4),   u(18), u(14),  u(54), 0)
    addCapsule(g, wire(color), u(3.5), u(16), u(16),  u(36), u(4))
    addCapsule(g, wire(color), u(4),   u(18), u(-14), u(54), 0)
    addCapsule(g, wire(color), u(3.5), u(16), u(-16), u(36), u(-4))
    addHelmet(g, wire(0x888888, alpha), u(9), u(8), 0, u(72), 0)
  } else {
    addBox(g, wire(color), u(7), u(14), u(10), u(8),  u(10), u(8))
    addBox(g, wire(color), u(7), u(14), u(10), u(-8), u(10), u(8))
    addBox(g, wire(color), u(7), u(14), u(10), u(8),  u(22), u(-4))
    addBox(g, wire(color), u(7), u(14), u(10), u(-8), u(22), u(-4))
    addBox(g, wire(color), u(20), u(10), u(14), 0, u(30), 0)
    addBox(g, wire(color), u(18), u(20), u(14), 0, u(42), u(-2))
    addBox(g, wire(color), u(26), u(8),  u(12), 0, u(50), 0)
    addCylinder(g, wire(color), u(4), u(4), u(5), 0, u(53), 0)
    addHead(g, wire(color), solid(color, alpha * 0.3), u(8), u(10), u(8), 0, u(59), 0)
    addCapsule(g, wire(color), u(4),   u(16), u(12),  u(48), u(6))
    addCapsule(g, wire(color), u(4),   u(16), u(-12), u(48), u(6))
    addCapsule(g, wire(color), u(3.5), u(14), u(10),  u(36), u(12))
    addCapsule(g, wire(color), u(3.5), u(14), u(-10), u(36), u(12))
    addHelmet(g, wire(0x888888, alpha), u(9), u(8), 0, u(62), 0)
  }

  if (alive) {
    const eyeY     = (crouching ? EYE_CROUCH : EYE_HEIGHT) * S
    const shaftLen = u(18)
    const headLen  = u(5)
    const mat      = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const shaft    = new THREE.Mesh(new THREE.CylinderGeometry(u(0.8), u(0.8), shaftLen, 6), mat)
    shaft.rotation.x = Math.PI / 2
    shaft.position.set(0, eyeY, shaftLen / 2)
    g.add(shaft)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(u(2), headLen, 6), mat)
    cone.rotation.x = Math.PI / 2
    cone.position.set(0, eyeY, shaftLen + headLen / 2)
    g.add(cone)
  }
  return g
}

function addBox(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z); g.add(m)
}
function addCylinder(g: THREE.Group, mat: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), mat)
  m.position.set(x, y + h / 2, z); g.add(m)
}
function addCapsule(g: THREE.Group, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number) {
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), mat)
  cyl.position.set(x, y + h / 2, z); g.add(cyl)
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat); s1.position.set(x, y, z); g.add(s1)
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat); s2.position.set(x, y + h, z); g.add(s2)
}
function addHead(g: THREE.Group, wfMat: THREE.Material, solidMat: THREE.Material,
  rx: number, ry: number, rz: number, x: number, y: number, z: number) {
  const geo = new THREE.SphereGeometry(1, 8, 6)
  geo.scale(rx, ry, rz)
  const wf = new THREE.Mesh(geo.clone(), wfMat); wf.position.set(x, y, z); g.add(wf)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(rx * 1.2, ry * 0.8), solidMat)
  face.position.set(x, y - ry * 0.1, z + rz * 0.9); g.add(face)
}
function addHelmet(g: THREE.Group, mat: THREE.Material, rx: number, ry: number, x: number, y: number, z: number) {
  const geo = new THREE.SphereGeometry(1, 6, 5, 0, Math.PI * 2, 0, Math.PI * 0.55)
  geo.scale(rx, ry, rx)
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m)
}

function makeLabel(text: string, color: number, crouching = false): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 44
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 44)
  if (crouching) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.strokeRect(6, 14, 10, 10) }
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.font = 'bold 15px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.shadowColor = '#000'; ctx.shadowBlur = 5
  ctx.fillText(text.slice(0, 14), 128, 22)
  const tex = new THREE.CanvasTexture(canvas)
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  spr.scale.set(12, 4.5, 1)
  return spr
}

function makeTextSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 44
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 44)
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6
  ctx.fillText(text.slice(0, 16), 128, 22)
  const tex = new THREE.CanvasTexture(canvas)
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  spr.scale.set(14, 5, 1)
  return spr
}
