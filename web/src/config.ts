import type { Coords } from './types'

/**
 * E-reception of the Chernivtsi city council. Source: Suspilne Chernivtsi, «Звернутися до влади онлайн»
 * (https://suspilne.media/chernivtsi/742891-zvernutisa-do-vladi-onlajn-ak-pracue-elektronna-prijmalna-u-cernivcah/):
 * «перейти на сайт приймальні за посиланням: https://e-cab.city.cv.ua/gov-ua-login».
 */
export const E_RECEPTION_URL = 'https://e-cab.city.cv.ua/gov-ua-login'

/** Start of the map when the phone gives no position: Central Square. */
export const CHERNIVTSI_CENTER: Coords = { lat: 48.2921, lon: 25.9358 }

/** Same box as CHERNIVTSI_BBOX in api/main.py: [[lat_min, lon_min], [lat_max, lon_max]]. */
export const CHERNIVTSI_BOUNDS: [[number, number], [number, number]] = [
  [48.2, 25.8],
  [48.4, 26.1],
]

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
