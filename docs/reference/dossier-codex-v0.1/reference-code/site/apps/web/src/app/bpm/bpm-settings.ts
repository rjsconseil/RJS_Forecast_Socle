import { siteSetting } from '../shared/site-settings';
import { VisionSettings } from './bpm-vision.model';

/** Les hypothèses de la vision, lues dans le catalogue de Configuration. */
export function visionSettings(): VisionSettings {
  return {
    inflationDefault: Number(siteSetting<string>('bpm.vision.inflationDefaut')),
    returnDefault: Number(siteSetting<string>('bpm.vision.rendementDefaut')),
    horizonYears: siteSetting<number>('bpm.vision.horizonAns'),
  };
}
