import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { useDemoStore, usePlaybackStore, useLayerStore } from '../stores'
import { getMapConfig, worldToPixel, isOnLowerLayer } from './mapUtils'
import KillFeed from './KillFeed'
import type { Position } from '../types'

const CANVAS_SIZE  = 1024
const TICKRATE     = 64
const TRAIL_TICKS  = 24
const BOMB_TIMER_S = 40
const BLOOM_TICKS  = 128  // ticks for smoke to fully expand

// Team colours
const CT    = 0x5b9cf6
const T     = 0xf97316
const DEAD  = 0x444444

// Grenade colours — selkeä värikoodi
const GREN: Record<string, number> = {
  smokegrenade: 0x9ca3af,  // harmaa
  flashbang:    0xfef08a,  // keltainen
  hegrenade:    0xef4444,  // punainen
  molotov:      0xf97316,  // oranssi
  incgrenade:   0xf97316,  // oranssi
  decoy:        0x86efac,  // vaaleanvihreä
}

// Grenade weapon names in active_weapon
const NADE_WEAPONS = new Set([
  'weapon_smokegrenade','weapon_flashbang','weapon_hegrenade',
  'weapon_molotov','weapon_incgrenade','weapon_decoy',
  'smokegrenade','flashbang','hegrenade','molotov','incgrenade','decoy',
])

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef       = useRef<PIXI.Application | null>(null)
  const layersRef    = useRef<Record<string, PIXI.Container>>({})
  const teamMapRef   = useRef<Record<string, 'CT' | 'T'>>({})

  const { selectedDemo, players, rounds } = useDemoStore()
  const {
    positions, kills, grenades, grenadeTrajectories,
    smokeEffects, bombEvents, flashEvents, infernoFires, shots,
    currentTick, allTicks, currentRound, tickProgress,
  } = usePlaybackStore()
  const L = useLayerStore()

  // Rebuild team lookup when players change
  useEffect(() => {
    const m: Record<string, 'CT' | 'T'> = {}
    players.forEach(p => { m[String(p.steam_id)] = p.team_start as 'CT' | 'T' })
    teamMapRef.current = m
  }, [players])

  // ── Pixi init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const app = new PIXI.Application({
      width: CANVAS_SIZE, height: CANVAS_SIZE,
      backgroundColor: 0x111111,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(app.view as HTMLCanvasElement)
    appRef.current = app

    // Layers in draw order (back → front)
    const names = ['map','trails','smokes','grenades','bomb','kills','shots','players','labels','timers']
    names.forEach(n => {
      const c = new PIXI.Container()
      app.stage.addChild(c)
      layersRef.current[n] = c
    })

    // Zoom toward cursor
    ;(app.view as HTMLCanvasElement).addEventListener('wheel', (e) => {
      e.preventDefault()
      const scale = app.stage.scale.x
      const f = e.deltaY < 0 ? 1.1 : 0.9
      const ns = Math.max(0.4, Math.min(6, scale * f))
      const rect = (app.view as HTMLCanvasElement).getBoundingClientRect()
      const mx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width)
      const my = (e.clientY - rect.top)  * (CANVAS_SIZE / rect.height)
      app.stage.x = mx - (mx - app.stage.x) * (ns / scale)
      app.stage.y = my - (my - app.stage.y) * (ns / scale)
      app.stage.scale.set(ns)
    })

    // Pan
    let drag = false, ox = 0, oy = 0, sx = 0, sy = 0
    app.stage.interactive = true
    app.stage.hitArea = new PIXI.Rectangle(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    app.stage.on('pointerdown',    (e: PIXI.FederatedPointerEvent) => { drag = true; ox = e.globalX; oy = e.globalY; sx = app.stage.x; sy = app.stage.y })
    app.stage.on('pointermove',    (e: PIXI.FederatedPointerEvent) => { if (drag) { app.stage.x = sx + e.globalX - ox; app.stage.y = sy + e.globalY - oy } })
    app.stage.on('pointerup',      () => { drag = false })
    app.stage.on('pointerupoutside',() => { drag = false })

    return () => { app.destroy(true); appRef.current = null }
  }, [])

  // ── Load map image ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!appRef.current || !selectedDemo) return
    const layer = layersRef.current['map']
    if (!layer) return
    layer.removeChildren()
    PIXI.Assets.load(`/${selectedDemo.map_name}.png`).then((tex: PIXI.Texture) => {
      const s = new PIXI.Sprite(tex)
      s.width = CANVAS_SIZE; s.height = CANVAS_SIZE
      layer.addChild(s)
    }).catch(() => {
      const g = new PIXI.Graphics()
      g.beginFill(0x1a2030).drawRect(0, 0, CANVAS_SIZE, CANVAS_SIZE).endFill()
      const t = new PIXI.Text(`Karttakuva puuttuu\nmaps/${selectedDemo.map_name}.png`,
        { fill: 0x4a5568, fontSize: 16, align: 'center', wordWrap: true, wordWrapWidth: 600 })
      t.x = CANVAS_SIZE/2 - 150; t.y = CANVAS_SIZE/2 - 30
      layer.addChild(g, t)
    })
  }, [selectedDemo])

  // ── Main draw (every tick) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!appRef.current || !selectedDemo || !positions.length) return
    const cfg = getMapConfig(selectedDemo.map_name)
    if (!cfg) return

    // World → screen pixel helper
    const toPx = (wx: number, wy: number, wz = 0) =>
      worldToPixel(wx, wy, cfg, CANVAS_SIZE, isOnLowerLayer(wz, cfg))

    // Round start tick — kills/grenades before this tick are from previous rounds
    const roundInfo = rounds.find(r => r.round_num === currentRound)
    const roundStartTick = roundInfo?.start_tick ?? (allTicks[0] ?? 0)

    // ── Player trails ─────────────────────────────────────────────────────────
    const trailLayer = layersRef.current['trails']
    trailLayer.removeChildren()
    trailLayer.visible = L.playerTrails
    if (L.playerTrails && allTicks.length) {
      const tickIdx = allTicks.indexOf(currentTick)
      const trailSet = new Set(allTicks.slice(Math.max(0, tickIdx - TRAIL_TICKS), tickIdx + 1))
      const byPlayer: Record<string, typeof positions> = {}
      positions
        .filter(p => trailSet.has(p.tick) && (p.is_alive === true || (p.is_alive as any) === 1))
        .forEach(p => { (byPlayer[p.steam_id] ??= []).push(p) })

      for (const [sid, trail] of Object.entries(byPlayer)) {
        if (trail.length < 2) continue
        const sorted = [...trail].sort((a, b) => a.tick - b.tick)
        const color  = teamMapRef.current[sid] === 'CT' ? CT : T
        const g = new PIXI.Graphics()
        sorted.forEach((pos, i) => {
          const p = toPx(pos.x, pos.y, pos.z)
          const alpha = 0.08 + 0.45 * (i / sorted.length)
          if (i === 0) { g.moveTo(p.x, p.y); return }
          g.lineStyle(1.5, color, alpha)
          g.lineTo(p.x, p.y)
        })
        trailLayer.addChild(g)
      }
    }

    // ── Smokes (with bloom) ───────────────────────────────────────────────────
    const smokeLayer = layersRef.current['smokes']
    smokeLayer.removeChildren()
    smokeLayer.visible = L.smokes
    if (L.smokes) {
      smokeEffects
        .filter(s => currentTick >= s.start_tick && currentTick <= s.end_tick)
        .forEach(s => {
          const p     = toPx(s.x, s.y, s.z)
          const bloom = Math.min(1, (currentTick - s.start_tick) / BLOOM_TICKS)
          // CS2 smoke radius ≈ 144 world units. scale = world units per radar pixel.
          // worldToPixel does: rawX = (wx - posX) / scale, then * (canvasSize/1024)
          // So 1 world unit = (1/scale) * (canvasSize/1024) pixels
          const factor = CANVAS_SIZE / 1024
          const r = (144 / cfg.scale) * factor * bloom

          const g = new PIXI.Graphics()
          // Dark semi-transparent fill — alpha fixed, only size blooms
          g.beginFill(0x6b7280, 0.60)
          g.drawCircle(p.x, p.y, r)
          g.endFill()
          // Inner highlight
          g.beginFill(0x9ca3af, 0.15)
          g.drawCircle(p.x, p.y, r * 0.6)
          g.endFill()
          // Crisp edge
          g.lineStyle(2, 0xd1d5db, 0.75)
          g.drawCircle(p.x, p.y, r)
          // Soft outer glow
          g.lineStyle(8, 0xffffff, 0.07)
          g.drawCircle(p.x, p.y, r * 1.03)
          smokeLayer.addChild(g)
        })
    }

    // ── Grenades + trajectories + blast effects ───────────────────────────────
    const grenLayer = layersRef.current['grenades']
    grenLayer.removeChildren()
    grenLayer.visible = L.grenades
    if (L.grenades) {
      const trajMap: Record<number, typeof grenadeTrajectories> = {}
      grenadeTrajectories.forEach(pt => { (trajMap[pt.grenade_id] ??= []).push(pt) })

      grenades.forEach(gr => {
        if (gr.tick_thrown > currentTick) return
        const color   = GREN[gr.grenade_type] ?? 0xffffff
        const allTraj = (trajMap[gr.id] ?? []).sort((a, b) => a.tick - b.tick)
        const traj    = allTraj.filter(pt => pt.tick <= currentTick)

        const isMolotov = gr.grenade_type === 'molotov' || gr.grenade_type === 'incgrenade'
        const isHE      = gr.grenade_type === 'hegrenade'
        const isFlash   = gr.grenade_type === 'flashbang'
        const isSmoke   = gr.grenade_type === 'smokegrenade'

        // Max flight ticks per type (sanity check against parser bugs)
        const maxFlight: Record<string, number> = {
          hegrenade: 448, flashbang: 384, smokegrenade: 640,
          molotov: 512, incgrenade: 512, decoy: 768,
        }
        const maxF = maxFlight[gr.grenade_type] ?? 640
        const rawDetTick = gr.tick_detonated
        const saneTick   = rawDetTick != null && rawDetTick < gr.tick_thrown + maxF ? rawDetTick : null

        // Fallback to last trajectory tick if DB value missing or insane
        // For molotovs: also check infernoFires for this grenade (gives start_tick)
        const infernoStartTick = isMolotov
          ? infernoFires.find(fp => fp.grenade_id === gr.id)?.tick ?? null
          : null
        const detTick   = saneTick ?? (allTraj.length ? allTraj[allTraj.length - 1].tick : null) ?? infernoStartTick
        const detonated = detTick != null && currentTick >= detTick
        const age       = detonated ? currentTick - detTick! : 0

        const BLAST_TICKS   = 48
        const MOLOTOV_TICKS = 384

        // Hide when effect is over
        if (isHE    && detonated && age > BLAST_TICKS)     return
        if (isFlash && detonated && age > BLAST_TICKS)     return
        if (isMolotov && detonated && age > MOLOTOV_TICKS) return
        if (isSmoke && detonated)                          return

        // ── Trajectory line ─────────────────────────────────────────────────
        if (traj.length >= 2 && (!detonated || age < BLAST_TICKS)) {
          const FADE_TICKS = 80
          for (let i = 1; i < traj.length; i++) {
            const pA     = toPx(traj[i-1].x, traj[i-1].y, traj[i-1].z)
            const pB     = toPx(traj[i].x,   traj[i].y,   traj[i].z)
            const segAge = currentTick - traj[i].tick
            const alpha  = detonated
              ? Math.max(0, (1 - age / BLAST_TICKS) * 0.6)
              : Math.max(0.12, 1 - segAge / FADE_TICKS) * 0.65
            if (alpha <= 0.01) continue
            const seg = new PIXI.Graphics()
            seg.lineStyle(1.5, color, alpha)
            seg.moveTo(pA.x, pA.y); seg.lineTo(pB.x, pB.y)
            grenLayer.addChild(seg)
          }
        }

        if (!detonated) {
          // ── In-flight grenade ───────────────────────────────────────────
          const last = traj[traj.length - 1]
          if (last) {
            const p   = toPx(last.x, last.y, last.z)
            const dot = new PIXI.Graphics()
            dot.beginFill(color, 0.92).drawCircle(p.x, p.y, 5).endFill()
            dot.lineStyle(1.5, 0xffffff, 0.6).drawCircle(p.x, p.y, 5)
            dot.beginFill(0xffffff, 0.5).drawCircle(p.x, p.y, 2).endFill()
            grenLayer.addChild(dot)
          }

        } else {
          // ── Detonation effects ──────────────────────────────────────────
          // Use detonate coords if available, else last trajectory point
          const dx = gr.detonate_x ?? (traj.length ? traj[traj.length-1].x : gr.throw_x)
          const dy = gr.detonate_y ?? (traj.length ? traj[traj.length-1].y : gr.throw_y)
          const dz = gr.detonate_z ?? (traj.length ? traj[traj.length-1].z : 0)
          const p  = toPx(dx, dy, dz)

          if (isHE && age < BLAST_TICKS) {
            const alpha = 1 - age / BLAST_TICKS
            const r     = 18 + 20 * (age / BLAST_TICKS)
            const blast = new PIXI.Graphics()
            blast.beginFill(0xff4400, alpha * 0.25).drawCircle(p.x, p.y, r).endFill()
            blast.lineStyle(3, 0xff6600, alpha * 0.95).drawCircle(p.x, p.y, r)
            blast.lineStyle(1.5, 0xffcc00, alpha * 0.5).drawCircle(p.x, p.y, r * 0.6)
            grenLayer.addChild(blast)

          } else if (isFlash && age < BLAST_TICKS) {
            const alpha = 1 - age / BLAST_TICKS
            const r     = 14 * (1 + age / BLAST_TICKS)
            const blast = new PIXI.Graphics()
            blast.beginFill(0xffffee, alpha * 0.55).drawCircle(p.x, p.y, r).endFill()
            blast.lineStyle(2, 0xffffff, alpha).drawCircle(p.x, p.y, r)
            grenLayer.addChild(blast)

          } else if (isMolotov && age < MOLOTOV_TICKS) {
            // Käytä fallbackia jos tällä granaatilla ei ole Go-parserin dataa
            const hasInfernoData = infernoFires.some(fp => fp.grenade_id === gr.id)
            if (!hasInfernoData && detonated) {
              const burnFrac = age / MOLOTOV_TICKS
              const flicker  = 0.75 + 0.25 * Math.sin(currentTick * 0.5)
              const baseR    = (18 + 10 * Math.min(1, age / 64))
              const fire     = new PIXI.Graphics()
              fire.beginFill(0xea580c, 0.50 * flicker * (1 - burnFrac * 0.4))
              fire.drawCircle(p.x, p.y, baseR).endFill()
              fire.beginFill(0xfbbf24, 0.30 * flicker)
              fire.drawCircle(p.x, p.y, baseR * 0.45).endFill()
              if (burnFrac > 0.7) {
                fire.beginFill(0x374151, ((burnFrac - 0.7) / 0.3) * 0.5)
                fire.drawCircle(p.x, p.y, baseR * 1.1).endFill()
              }
              grenLayer.addChild(fire)
            }
            // Oikeat liekkipisteet piirretään infernoFires-lohkossa jos data saatavilla
          }
        }
      })

      // ── Inferno fire points (oikea geometria Go-parserista) ────────────────
      if (infernoFires.length > 0) {
        // Rakenna per-grenade pisteet tälle tikille: etsi lähin tick per granaatti
        const firesByGid: Record<number, { x: number; y: number }[]> = {}
        // Kerää kaikki mahdolliset tikit per granaatti
        const gidTicks: Record<number, number[]> = {}
        infernoFires.forEach(fp => {
          (gidTicks[fp.grenade_id] ??= []).push(fp.tick)
        })
        // Per granaatti: löydä lähin tick joka on <= currentTick
        const gidActiveTick: Record<number, number> = {}
        Object.entries(gidTicks).forEach(([gidStr, ticks]) => {
          const gid = Number(gidStr)
          const validTicks = ticks.filter(t => t <= currentTick)
          if (validTicks.length === 0) return
          gidActiveTick[gid] = Math.max(...validTicks)
        })
        // Kerää pisteet aktiiviselta tikiltä
        infernoFires.forEach(fp => {
          if (gidActiveTick[fp.grenade_id] === fp.tick) {
            (firesByGid[fp.grenade_id] ??= []).push({ x: fp.x, y: fp.y })
          }
        })

        // Tarkista onko granaatti vielä aktiivinen (tick_detonated + MOLOTOV_TICKS)
        const molotovMap: Record<number, typeof grenades[0]> = {}
        grenades.forEach(gr => {
          if (gr.grenade_type === 'molotov' || gr.grenade_type === 'incgrenade') {
            molotovMap[gr.id] = gr
          }
        })

        const MOLOTOV_TICKS = 384
        Object.entries(firesByGid).forEach(([gidStr, rawPts]) => {
          const gid = Number(gidStr)
          const gr  = molotovMap[gid]
          if (!gr) return
          const maxF = 512
          const rawDet = gr.tick_detonated
          const saneDet = rawDet != null && rawDet < gr.tick_thrown + maxF ? rawDet : null
          const detTick = saneDet ?? (currentTick - 1) // fallback: oletetaan jo detonoituneeksi
          if (currentTick < detTick) return
          const age = currentTick - detTick
          if (age > MOLOTOV_TICKS) return

          const burnFrac = age / MOLOTOV_TICKS
          const flicker  = 0.75 + 0.25 * Math.sin(currentTick * 0.5)

          const fire = new PIXI.Graphics()
          // Piirretään jokainen liekkipiste pienenä ympyränä
          const FIRE_R = 7  // world units → pikseleiksi cfg.scale:n kautta
          rawPts.forEach(fp => {
            const pt = toPx(fp.x, fp.y)
            // Oranssi täyttö
            fire.beginFill(0xea580c, 0.55 * flicker * (1 - burnFrac * 0.4))
            fire.drawCircle(pt.x, pt.y, FIRE_R)
            fire.endFill()
            // Keltainen ydin
            fire.beginFill(0xfbbf24, 0.35 * flicker)
            fire.drawCircle(pt.x, pt.y, FIRE_R * 0.45)
            fire.endFill()
          })

          // Häivytys sammumisessa
          if (burnFrac > 0.7) {
            rawPts.forEach(fp => {
              const pt = toPx(fp.x, fp.y)
              fire.beginFill(0x374151, ((burnFrac - 0.7) / 0.3) * 0.5)
              fire.drawCircle(pt.x, pt.y, FIRE_R * 1.2)
              fire.endFill()
            })
          }
          grenLayer.addChild(fire)
        })
      }
    } // if (L.grenades)

    // ── Bomb ─────────────────────────────────────────────────────────────────
    const bombLayer = layersRef.current['bomb']
    bombLayer.removeChildren()
    bombLayer.visible = L.bomb
    if (L.bomb && bombEvents.length) {
      const past    = bombEvents.filter(b => b.tick <= currentTick)
      const plant   = [...past].reverse().find(b => b.event_type === 'plant')
      const explode = [...past].reverse().find(b => b.event_type === 'explode')
      const defuse  = [...past].reverse().find(b => b.event_type === 'defuse')

      if (plant) {
        const p = toPx(plant.x, plant.y)
        const g = new PIXI.Graphics()

        if (explode) {
          // Exploded
          const age   = currentTick - explode.tick
          const pulse = 0.6 + 0.4 * Math.sin(age / 6)
          g.lineStyle(3, 0xff0000, pulse)
          g.beginFill(0xff0000, 0.18 * pulse).drawCircle(p.x, p.y, 18).endFill()
          g.drawCircle(p.x, p.y, 18)

          const lbl = new PIXI.Text('BOOM', { fill: 0xff4444, fontSize: 10, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 })
          lbl.x = p.x - lbl.width/2; lbl.y = p.y - 30
          bombLayer.addChild(lbl)

        } else if (defuse) {
          // Defused
          g.beginFill(0x4488ff, 0.9).drawCircle(p.x, p.y, 8).endFill()
          g.lineStyle(2, 0xffffff, 0.8).drawCircle(p.x, p.y, 8)

          const lbl = new PIXI.Text('DEFUSED', { fill: 0x4488ff, fontSize: 9, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 })
          lbl.x = p.x - lbl.width/2; lbl.y = p.y - 22
          bombLayer.addChild(lbl)

        } else {
          // Active bomb — show countdown
          const elapsed  = (currentTick - plant.tick) / TICKRATE
          const secsLeft = Math.max(0, BOMB_TIMER_S - elapsed)
          const fraction = secsLeft / BOMB_TIMER_S
          const critical = secsLeft < 10
          const pulse    = critical ? (0.7 + 0.3 * Math.sin(currentTick / 5)) : 1.0

          // Base pulsing dot
          g.beginFill(0xff4400, 0.9 * pulse).drawCircle(p.x, p.y, 7).endFill()
          g.lineStyle(2, 0xffaa00, pulse).drawCircle(p.x, p.y, 11)

          // Countdown arc
          const arc = new PIXI.Graphics()
          arc.lineStyle(3, critical ? 0xff2222 : 0xff6600, 0.9)
          arc.arc(p.x, p.y, 16, -Math.PI/2, -Math.PI/2 + fraction * Math.PI * 2)
          bombLayer.addChild(arc)

          // Timer text
          const timerTxt = new PIXI.Text(secsLeft.toFixed(1) + 's', {
            fill: critical ? 0xff2222 : 0xffcc00,
            fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold',
            stroke: 0x000000, strokeThickness: 3,
          })
          timerTxt.x = p.x - timerTxt.width/2
          timerTxt.y = p.y - 34
          bombLayer.addChild(timerTxt)

          // Site label
          if (plant.site) {
            const siteTxt = new PIXI.Text(plant.site, {
              fill: 0xffaa00, fontSize: 12, fontWeight: 'bold',
              stroke: 0x000000, strokeThickness: 3,
            })
            siteTxt.x = p.x - siteTxt.width/2
            siteTxt.y = p.y + 15
            bombLayer.addChild(siteTxt)
          }
        }
        bombLayer.addChild(g)
      }
    }

    // ── Kill markers ─────────────────────────────────────────────────────────
    const killLayer = layersRef.current['kills']
    killLayer.removeChildren()
    killLayer.visible = L.kills
    if (L.kills) {
      kills
        .filter(k => k.tick >= roundStartTick && k.tick <= currentTick)
        .forEach(k => {
          const p   = toPx(k.victim_x, k.victim_y)
          const hs  = k.headshot
          const col = hs ? 0xef4444 : 0xf97316
          const s   = hs ? 6 : 5
          const g   = new PIXI.Graphics()
          g.lineStyle(hs ? 2.5 : 2, col, 0.85)
          g.moveTo(p.x-s, p.y-s); g.lineTo(p.x+s, p.y+s)
          g.moveTo(p.x+s, p.y-s); g.lineTo(p.x-s, p.y+s)
          if (L.killLines && k.attacker_x && k.attacker_y) {
            const a = toPx(k.attacker_x, k.attacker_y)
            g.lineStyle(1, col, 0.18)
            g.moveTo(a.x, a.y); g.lineTo(p.x, p.y)
          }
          killLayer.addChild(g)
        })
    }

    // ── Shot trajectories ─────────────────────────────────────────────────────
    const shotLayer = layersRef.current['shots']
    shotLayer.removeChildren()
    shotLayer.visible = L.shots
    if (L.shots) {
      const SHOT_FADE_TICKS = 48
      const SHOT_LENGTH_PX  = 80
      shots
        .filter(s => s.tick >= roundStartTick && s.tick <= currentTick && currentTick - s.tick <= SHOT_FADE_TICKS)
        .forEach(s => {
          const age   = currentTick - s.tick
          const alpha = Math.max(0.05, 1 - age / SHOT_FADE_TICKS)
          const p     = toPx(s.x, s.y, s.z)
          const rad   = s.yaw * Math.PI / 180
          const ex    = p.x + Math.cos(rad) * SHOT_LENGTH_PX
          const ey    = p.y - Math.sin(rad) * SHOT_LENGTH_PX
          const team  = teamMapRef.current[String(s.steam_id)]
          const col   = team === 'CT' ? 0x93c5fd : 0xfb923c
          const g     = new PIXI.Graphics()
          g.lineStyle(1.2, col, alpha * 0.85)
          g.moveTo(p.x, p.y)
          g.lineTo(ex, ey)
          g.beginFill(col, alpha * 0.6).drawCircle(p.x, p.y, 1.5).endFill()
          shotLayer.addChild(g)
        })
    }

    // ── Players + HP arc + facing arrow + flash timer ─────────────────────────
    const playerLayer = layersRef.current['players']
    const labelLayer  = layersRef.current['labels']
    const timerLayer  = layersRef.current['timers']
    playerLayer.removeChildren()
    labelLayer.removeChildren()
    timerLayer.removeChildren()
    playerLayer.visible = L.players

    if (L.players) {
      // Pre-index: steamId → sorted positions array (built once per tick change, not per frame)
      // Use tickProgress for sub-tick lerp between currentTick and nextTick
      const nextTick = allTicks[allTicks.indexOf(currentTick) + 1] ?? currentTick

      // Build O(1) lookup: steamId → { cur, next }
      const posIndex: Record<string, { cur?: Position; next?: Position }> = {}
      for (const p of positions) {
        const sid = String(p.steam_id)
        if (p.tick === currentTick) {
          (posIndex[sid] ??= {}).cur = p
        } else if (p.tick === nextTick) {
          (posIndex[sid] ??= {}).next = p
        }
      }

      const steamIds = Object.keys(posIndex)

      steamIds.forEach(steamId => {
        const { cur: pA, next: pB } = posIndex[steamId]
        if (!pA) return

        const alive = pA.is_alive === true || (pA.is_alive as any) === 1
        const pN    = pB ?? pA
        const t     = tickProgress  // 0.0–1.0 from RAF

        // Lerp position + yaw using sub-tick progress
        let wx = pA.x + (pN.x - pA.x) * t
        let wy = pA.y + (pN.y - pA.y) * t
        let wz = pA.z + (pN.z - pA.z) * t
        let dy = pN.yaw - pA.yaw
        if (dy > 180) dy -= 360
        if (dy < -180) dy += 360
        const yaw = pA.yaw + dy * t

        const p     = toPx(wx, wy, wz)
        const team  = teamMapRef.current[steamId]
        const color = alive ? (team === 'CT' ? CT : T) : DEAD
        const g     = new PIXI.Graphics()

        if (alive) {
          // Body
          g.beginFill(color, 0.92).drawCircle(p.x, p.y, 8).endFill()
          g.lineStyle(1.5, 0xffffff, 0.7).drawCircle(p.x, p.y, 8)

          // Facing arrow
          // CS2 yaw: 0=East, positive=CCW. Screen Y inverted → negate sin component
          const rad = yaw * Math.PI / 180
          const fx  = p.x + Math.cos(rad) * 16
          const fy  = p.y - Math.sin(rad) * 16  // ← negative: screen Y is flipped
          g.lineStyle(2.5, 0xffffff, 0.92)
          g.moveTo(p.x, p.y); g.lineTo(fx, fy)

          // HP arc
          const hpFrac  = Math.max(0, pA.health) / 100
          const hpColor = hpFrac > 0.5 ? 0x4ade80 : hpFrac > 0.25 ? 0xfbbf24 : 0xf87171
          const arc     = new PIXI.Graphics()
          arc.lineStyle(2.5, hpColor, 0.9)
          arc.arc(p.x, p.y, 12, -Math.PI/2, -Math.PI/2 + hpFrac * Math.PI * 2)
          playerLayer.addChild(arc)

          // Grenade-in-hand indicator — outer ring in grenade color
          const weapon = pA.active_weapon ?? ''
          const nadeType = weapon.replace('weapon_', '')
          const nadeColor = GREN[nadeType]
          if (nadeColor !== undefined) {
            const nadeRing = new PIXI.Graphics()
            nadeRing.lineStyle(2.5, nadeColor, 0.9)
            nadeRing.drawCircle(p.x, p.y, 16)
            // Small type dot above player
            nadeRing.beginFill(nadeColor, 0.95).drawCircle(p.x, p.y - 20, 3).endFill()
            playerLayer.addChild(nadeRing)
          }

          // Flash timer ring
          if (flashEvents) {
            // Find the latest active flash for this player
            const flashed = [...flashEvents]
              .filter(fe => fe.blinded_steam_id === steamId)
              .filter(fe => {
                const endTick = fe.tick + Math.round(fe.flash_duration * TICKRATE)
                return currentTick >= fe.tick && currentTick <= endTick
              })
              .sort((a, b) => b.tick - a.tick)[0]

            if (flashed) {
              const endTick   = flashed.tick + Math.round(flashed.flash_duration * TICKRATE)
              const remaining = Math.max(0, (endTick - currentTick) / TICKRATE)
              const fraction  = remaining / flashed.flash_duration

              const flashRing = new PIXI.Graphics()
              flashRing.lineStyle(3, 0xffffff, 0.88)
              flashRing.arc(p.x, p.y, 18, -Math.PI/2, -Math.PI/2 + fraction * Math.PI * 2)
              timerLayer.addChild(flashRing)

              if (remaining > 0.1) {
                const ftxt = new PIXI.Text(remaining.toFixed(1) + 's', {
                  fill: 0xffffff, fontSize: 8, fontFamily: 'monospace',
                  stroke: 0x000000, strokeThickness: 2,
                })
                ftxt.x = p.x - ftxt.width/2; ftxt.y = p.y + 24
                timerLayer.addChild(ftxt)
              }
            }
          }

          // Label
          if (L.playerLabels) {
            const name = players.find(pl => String(pl.steam_id) === String(steamId))?.name ?? steamId.slice(-5)
            const lbl  = new PIXI.Text(
              `${name.slice(0, 12)}  ${pA.health}hp`,
              { fill: 0xffffff, fontSize: 9, fontFamily: 'monospace', stroke: 0x000000, strokeThickness: 2.5 }
            )
            lbl.x = p.x - lbl.width/2; lbl.y = p.y - 26
            labelLayer.addChild(lbl)
          }
        } else {
          // Dead: small grey X
          g.lineStyle(1.5, 0x444444, 0.55)
          g.moveTo(p.x-5, p.y-5); g.lineTo(p.x+5, p.y+5)
          g.moveTo(p.x+5, p.y-5); g.lineTo(p.x-5, p.y+5)
        }
        playerLayer.addChild(g)
      })
    }

    // Apply remaining visibility toggles
    labelLayer.visible  = L.playerLabels
    timerLayer.visible  = true
    killLayer.visible   = L.kills
    shotLayer.visible   = L.shots
    grenLayer.visible   = L.grenades
    smokeLayer.visible  = L.smokes
    bombLayer.visible   = L.bomb

  }, [currentTick, tickProgress, currentRound, L, selectedDemo, positions, kills, grenades,
      grenadeTrajectories, smokeEffects, bombEvents, flashEvents, infernoFires, shots, allTicks, players])

  return (
    <div className="w-full h-full overflow-hidden relative cursor-grab active:cursor-grabbing">
      <div ref={containerRef} className="w-full h-full" />
      <KillFeed />
    </div>
  )
}