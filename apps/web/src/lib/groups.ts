/** How conditions are grouped in the "Look for" list and the filter quiz. */
export const CONDITION_GROUPS: { label: string; ids: string[]; hint: string }[] = [
  {
    label: 'Light and sky',
    ids: ['sky', 'dramatic', 'clarity', 'lenticular'],
    hint: 'Colour, drama, long views, wave clouds',
  },
  {
    label: 'Cloud and water',
    ids: ['inversion', 'mist', 'reflections', 'waterfalls'],
    hint: 'Inversions, mist, still lochs, waterfalls',
  },
  {
    label: 'Winter',
    ids: ['snow', 'alpenglow', 'frost', 'frozen'],
    hint: 'Snow, alpenglow, hoar frost, frozen lochs',
  },
  { label: 'Night', ids: ['astro', 'aurora'], hint: 'Stars, the Milky Way and aurora' },
  { label: 'On foot', ids: ['walking'], hint: 'A good day on the hill' },
];
