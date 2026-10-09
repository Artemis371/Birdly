// Birdly's bird mark, as raw SVG paths on a 24x24 grid. Shared by the React
// logo and the favicon route so there is exactly one drawing of the bird.
export const BIRD_VIEWBOX = "0 0 24 24";
// Body facing right: round head, short beak at the right, tail sweeping down-left.
export const BIRD_BODY =
  "M3.5 15.2c0-5.1 4.1-9.2 9.2-9.2 3.4 0 6.2 1.9 7.4 4.9l3 1.2-3 1.3c-1 4.3-4.7 7.4-9.1 7.4H3.2l2.6-2.4c-1.5-.9-2.3-1.9-2.3-3.2z";
export const BIRD_WING = "M7.6 14.6c2.9.2 5.6-1 7.2-3.4";
export const BIRD_EYE = { cx: 15.6, cy: 10.4, r: 1.15 };

export function birdIconSvg(fg: string, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="8" fill="${bg}"/>
<g transform="translate(4 3.2)">
<path d="${BIRD_BODY}" fill="${fg}"/>
<path d="${BIRD_WING}" fill="none" stroke="${bg}" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="${BIRD_EYE.cx}" cy="${BIRD_EYE.cy}" r="${BIRD_EYE.r}" fill="${bg}"/>
</g>
</svg>`;
}
