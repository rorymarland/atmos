import { describe, expect, it } from 'vitest';
import { gridRefToLatLon, gridToOsgb36, parseGridRef, parseLocation } from './osgrid.js';

describe('OS grid references', () => {
  it('reads references in their usual forms', () => {
    expect(parseGridRef('NN 16667 71256')).toEqual({
      easting: 216667.5,
      northing: 771256.5,
      precisionM: 1,
    });
    expect(parseGridRef('nn166712')).toEqual({
      easting: 216650,
      northing: 771250,
      precisionM: 100,
    });
    expect(parseGridRef('TG 51409 13177')!.easting).toBeCloseTo(651409.5);
    expect(parseGridRef('NN 166 7123')).toBeNull();
    expect(parseGridRef('NI 123 456')).toBeNull();
    expect(parseGridRef('Ben Nevis')).toBeNull();
  });

  it('matches the OS worked example: TG 51409 13177 is 52°39′27.2531″N 1°43′4.5177″E (OSGB36)', () => {
    const { phi, lambda } = gridToOsgb36(651409.903, 313177.27);
    expect((phi * 180) / Math.PI).toBeCloseTo(52 + 39 / 60 + 27.2531 / 3600, 6);
    expect((lambda * 180) / Math.PI).toBeCloseTo(1 + 43 / 60 + 4.5177 / 3600, 6);
    // Shifted to WGS84 (GPS), about 50 m north and 110 m west there.
    const p = gridRefToLatLon('TG 51409 13177')!;
    expect(p.lat).toBeCloseTo(52.65798, 4);
    expect(p.lon).toBeCloseTo(1.71605, 4);
  });

  it('puts Ben Nevis where DoBIH does', () => {
    // DoBIH: NN 16667 71256 is 56.79689, -5.00368.
    const p = gridRefToLatLon('NN 16667 71256')!;
    expect(p.lat).toBeCloseTo(56.7969, 3);
    expect(p.lon).toBeCloseTo(-5.0037, 3);
  });

  it('takes decimal latitude and longitude in the UK', () => {
    expect(parseLocation('56.796, -5.004')).toEqual({ lat: 56.796, lon: -5.004 });
    expect(parseLocation('54.6 -5.9')).toEqual({ lat: 54.6, lon: -5.9 });
    expect(parseLocation('40.7, -74.0')).toBeNull();
  });
});
