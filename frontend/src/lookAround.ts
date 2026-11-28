// When the place picker asks for the phone's location: once someone has clearly
// been looking around, not the moment it opens. 4 list swipes, or 7 map touches
// or zooms, or 3 of each, whichever comes first.
export function lookedEnough(swipes: number, mapTouches: number) {
  return swipes >= 4 || mapTouches >= 7 || (swipes >= 3 && mapTouches >= 3);
}
