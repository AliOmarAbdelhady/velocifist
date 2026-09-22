// Car tune registry — loads the JSON data files and exposes them typed.
// The whole car is data (PLAN §6.5): physics code is car-agnostic.

import type { CarTune } from './car';
import falcone from './cars/falcone-gt.json';
import vipera from './cars/vipera-rs.json';
import bruto from './cars/bruto-widebody.json';

export const CAR_TUNES: readonly CarTune[] = [
  falcone as CarTune,
  vipera as CarTune,
  bruto as CarTune,
];
