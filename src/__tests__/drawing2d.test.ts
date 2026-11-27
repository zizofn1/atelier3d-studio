import { describe, expect, it } from 'vitest';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import {
  buildPlanDrawing2D,
  buildWallElevationDrawing2D,
  renderDrawing2DToSvg,
} from '@/exports/drawing2d';

describe('Dessin technique 2D & Élévations cotées (drawing2d IR)', () => {
  it('builds a plan 2D IR with wall length dimensions and valid standalone SVG', () => {
    const project = createCuisineEnLTemplate();
    const plan = buildPlanDrawing2D(project, 'mm');

    expect(plan.kind).toBe('plan');
    expect(plan.dimensions.length).toBe(project.walls.length);
    // mur-nord centerline 3850 mm -> net interior face-to-face 3700 mm (3850 - 75 - 75)
    expect(plan.dimensions.some((d) => /3[\s\u00a0\u202f]?700/.test(d.label))).toBe(true);

    const svg = renderDrawing2DToSvg(plan);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox=');
    expect(svg).toMatch(/3[\s\u00a0\u202f]?700\s*mm/);
    expect(svg).toContain('M01');
  });

  it('builds a wall elevation IR with multi-tier mm cotations and projected modules', () => {
    const project = createCuisineEnLTemplate();
    const elev = buildWallElevationDrawing2D(project, 'mur-nord', 'mm');

    expect(elev.kind).toBe('elevation');
    // Overall wall length and ceiling height dimensions
    expect(
      elev.dimensions.some((d) => d.orientation === 'H' && /3[\s\u00a0\u202f]?850/.test(d.label))
    ).toBe(true);
    expect(
      elev.dimensions.some((d) => d.orientation === 'V' && /2[\s\u00a0\u202f]?500/.test(d.label))
    ).toBe(true);
    // Modules attached to mur-nord appear with their refs
    expect(elev.texts.some((t) => t.text === 'M01')).toBe(true);
    expect(elev.texts.some((t) => t.text === 'M02')).toBe(true);

    const svg = renderDrawing2DToSvg(elev);
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/3[\s\u00a0\u202f]?850\s*mm/);
    expect(svg).toMatch(/2[\s\u00a0\u202f]?500\s*mm/);
  });
});
