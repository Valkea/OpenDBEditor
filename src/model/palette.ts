// Group / accent palette. Hues chosen to stay distinguishable on both the dark
// and light canvases; regions use them at low alpha, chips at full strength.
export const PALETTE = [
  '#7c9cff', // periwinkle
  '#5eead4', // teal
  '#f0abfc', // orchid
  '#fbbf24', // amber
  '#86efac', // mint
  '#fda4af', // rose
  '#93c5fd', // sky
  '#c4b5fd', // lavender
  '#fdba74', // apricot
  '#67e8f9', // cyan
];

export const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa'];

export function paletteColor(i: number): string {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
