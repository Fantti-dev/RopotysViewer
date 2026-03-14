import type { MapConfig } from '../types'
import mapConfigs from '../../../../maps/map_configs.json'

export function getMapConfig(mapName: string): MapConfig | null {
  return (mapConfigs as Record<string, MapConfig>)[mapName] ?? null
}

/**
 * Muuntaa CS2:n world-koordinaatit karttakuvan pikselikoordinaateiksi.
 * Canvas on aina CANVAS_SIZE x CANVAS_SIZE — kartta skaalataan siihen.
 */
export function worldToPixel(
  worldX: number,
  worldY: number,
  config: MapConfig,
  canvasSize: number,
  useLower = false
): { x: number; y: number } {
  const posX  = useLower ? (config.lower_offset_x ?? config.pos_x) : config.pos_x
  const posY  = useLower ? (config.lower_offset_y ?? config.pos_y) : config.pos_y
  const scale = useLower ? (config.lower_scale   ?? config.scale)  : config.scale

  // CS2:n koordinaatit → normalisoitu 0..1024 (radar-kuvan resoluutio)
  const rawX = (worldX - posX) / scale
  const rawY = (posY - worldY) / scale   // Y-akseli käännetty!

  // Skaalataan canvas-kokoon (radar on yleensä 1024x1024)
  const factor = canvasSize / 1024

  return {
    x: rawX * factor,
    y: rawY * factor,
  }
}

/**
 * Lineaarinen interpolointi kahden sijainnin välillä (lerp).
 * Käytetään sulavaan animaatioon tickien välillä.
 */
export function lerpPosition(
  x1: number, y1: number,
  x2: number, y2: number,
  t: number // 0..1
): { x: number; y: number } {
  return {
    x: x1 + (x2 - x1) * t,
    y: y1 + (y2 - y1) * t,
  }
}

/**
 * Määrittää onko pelaaja lower-layerilla Z-koordinaatin perusteella.
 */
export function isOnLowerLayer(z: number, config: MapConfig): boolean {
  if (!config.has_lower || config.z_threshold === undefined) return false
  return z < config.z_threshold
}