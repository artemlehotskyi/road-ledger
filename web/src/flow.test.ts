// Run: npm test (Node's own runner; Node 23.6+ runs TypeScript without a build step)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextScreen, sendsPhonePosition } from './flow.ts'
import type { AnalyzeResponse } from './types.ts'

const summary = (verdict: AnalyzeResponse['summary']['verdict']) => ({ verdict, title: '', headline: '' })
const at = (source: 'manual' | 'exif') => ({ lat: 48.29, lon: 25.96, source })

test('only a camera shot sends the phone position', () => {
  assert.equal(sendsPhonePosition('camera'), true)
  assert.equal(sendsPhonePosition('gallery'), false)
  assert.equal(sendsPhonePosition('map'), false)
})

test('camera: phone position, or the photo EXIF when the phone gave none', () => {
  assert.deepEqual(nextScreen('camera', { summary: summary('active'), location: at('manual') }), { screen: 'result', locSource: 'device' })
  assert.deepEqual(nextScreen('camera', { summary: summary('active'), location: at('exif') }), { screen: 'result', locSource: 'photo' })
})

test('gallery with EXIF GPS: coordinates from the photo', () => {
  assert.deepEqual(nextScreen('gallery', { summary: summary('no_contracts'), location: at('exif') }), { screen: 'result', locSource: 'photo' })
})

test('gallery without EXIF GPS: the map, with the no-geolocation note', () => {
  assert.deepEqual(nextScreen('gallery', { summary: summary('no_location'), location: null }), { screen: 'locate', noPhotoGps: true })
})

test('camera without any position: the map, without the gallery note', () => {
  assert.deepEqual(nextScreen('camera', { summary: summary('no_location'), location: null }), { screen: 'locate', noPhotoGps: false })
})

test('point from the map', () => {
  assert.deepEqual(nextScreen('map', { summary: summary('expired'), location: at('manual') }), { screen: 'result', locSource: 'map' })
})
