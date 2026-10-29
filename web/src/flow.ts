/**
 * Where the coordinates of a photo come from, by how it was picked:
 * camera — the phone position; gallery — only the photo's own EXIF GPS (the phone may be elsewhere now);
 * map — the point the person confirmed.
 */
import type { AnalyzeResponse, LocSource } from './types'

export type PhotoSource = 'camera' | 'gallery' | 'map'

export type Next =
  | { screen: 'result'; locSource: LocSource }
  | { screen: 'locate'; noPhotoGps: boolean } // noPhotoGps: a gallery photo without EXIF GPS

/** Only a fresh camera shot is sent with the phone position; /analyze prefers form coordinates over EXIF. */
export function sendsPhonePosition(source: PhotoSource) {
  return source === 'camera'
}

export function nextScreen(source: PhotoSource, data: Pick<AnalyzeResponse, 'summary' | 'location'>): Next {
  if (data.summary.verdict === 'no_location') return { screen: 'locate', noPhotoGps: source === 'gallery' }
  if (source === 'map') return { screen: 'result', locSource: 'map' }
  return { screen: 'result', locSource: data.location?.source === 'exif' ? 'photo' : 'device' }
}
