/** How conditions are grouped in the "Look for" list and the filter quiz. */
export const CONDITION_GROUPS: { label: string; ids: string[]; hint: string }[] = [
  {
    label: 'Light and sky',
    ids: ['sky', 'dramatic', 'clarity', 'lenticular', 'rainbow'],
    hint: 'Colour, drama, long views, wave clouds, rainbows',
  },
  {
    label: 'Cloud and water',
    ids: ['inversion', 'brocken', 'mist', 'reflections', 'waterfalls'],
    hint: 'Inversions, Brocken spectres, mist, still lochs, waterfalls',
  },
  {
    label: 'Winter',
    ids: ['snow', 'bluebird', 'alpenglow', 'frost', 'frozen'],
    hint: 'Snow, bluebird days, alpenglow, hoar frost, frozen lochs',
  },
  {
    label: 'Night',
    ids: ['astro', 'aurora', 'noctilucent'],
    hint: 'Stars, the Milky Way, aurora, noctilucent clouds',
  },
  { label: 'On foot', ids: ['walking'], hint: 'A good day on the hill' },
];
