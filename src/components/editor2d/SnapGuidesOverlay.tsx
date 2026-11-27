import type { CollisionWarning, DisplayUnit, SnapGuide } from '@/types';
import type { ModuleAutoFitSolution } from '@/engine/geometry';
import { formatDim } from '@/utils/units';

interface SnapGuidesSvgProps {
  guides: SnapGuide[];
  draftWall?: {
    start: [number, number];
    end: [number, number];
    isOrtho: boolean;
  } | null;
  displayUnit: DisplayUnit;
}

export function SnapGuidesSvg({ guides, draftWall, displayUnit }: SnapGuidesSvgProps) {
  return (
    <g pointerEvents="none">
      {guides.map((g, idx) => (
        <g key={`snap-${idx}`}>
          <line
            x1={g.x1Mm}
            y1={g.z1Mm}
            x2={g.x2Mm}
            y2={g.z2Mm}
            stroke={g.kind === 'wall' ? '#34d399' : '#fbbf24'}
            strokeWidth={18}
            strokeDasharray="40 25"
          />
          {g.labelFr && (
            <text
              x={(g.x1Mm + g.x2Mm) / 2}
              y={(g.z1Mm + g.z2Mm) / 2 - 45}
              textAnchor="middle"
              fill={g.kind === 'wall' ? '#6ee7b7' : '#fde68a'}
              fontSize={75}
              fontWeight={600}
            >
              {g.labelFr}
            </text>
          )}
        </g>
      ))}

      {draftWall && (() => {
        const dx = draftWall.end[0] - draftWall.start[0];
        const dz = draftWall.end[1] - draftWall.start[1];
        const len = Math.hypot(dx, dz);
        const angleDeg = Math.round(((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360);
        const mx = (draftWall.start[0] + draftWall.end[0]) / 2;
        const mz = (draftWall.start[1] + draftWall.end[1]) / 2;
        return (
          <g>
            {/* Orthogonal alignment guide lines */}
            {draftWall.isOrtho && (
              <line
                x1={draftWall.start[0] - dx * 2}
                y1={draftWall.start[1] - dz * 2}
                x2={draftWall.end[0] + dx * 2}
                y2={draftWall.end[1] + dz * 2}
                stroke="#38bdf8"
                strokeWidth={10}
                strokeDasharray="36 24"
                opacity={0.55}
              />
            )}
            <line
              x1={draftWall.start[0]}
              y1={draftWall.start[1]}
              x2={draftWall.end[0]}
              y2={draftWall.end[1]}
              stroke="#fbbf24"
              strokeWidth={140}
              strokeOpacity={0.55}
              strokeLinecap="square"
            />
            <circle cx={draftWall.start[0]} cy={draftWall.start[1]} r={55} fill="#fbbf24" />
            <circle cx={draftWall.end[0]} cy={draftWall.end[1]} r={55} fill="#38bdf8" />
            {len >= 20 && (
              <g transform={`translate(${mx}, ${mz - 140})`}>
                <rect
                  x={-280}
                  y={-75}
                  width={560}
                  height={130}
                  rx={24}
                  fill="#0f172a"
                  stroke="#fbbf24"
                  strokeWidth={12}
                />
                <text
                  x={0}
                  y={-5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fef3c7"
                  fontSize={78}
                  fontWeight={700}
                >
                  {formatDim(len, displayUnit)} · {angleDeg}°
                </text>
              </g>
            )}
          </g>
        );
      })()}
    </g>
  );
}

interface CollisionWarningsBannerProps {
  warnings: CollisionWarning[];
  fixableSolutions?: Map<string, ModuleAutoFitSolution>;
  onAutoFitModule?: (moduleId: string) => void;
}

export function CollisionWarningsBanner({
  warnings,
  fixableSolutions,
  onAutoFitModule,
}: CollisionWarningsBannerProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      data-testid="collision-warnings-banner"
      role="alert"
      className="mt-2 space-y-1 rounded-lg border border-red-500/50 bg-red-500/12 px-3 py-2 text-xs text-atelier-danger"
    >
      <div className="font-semibold">
        Collision détectée ({warnings.length}) — Chevauchement à corriger :
      </div>
      {warnings.slice(0, 3).map((w) => {
        const sol = fixableSolutions?.get(w.moduleId);
        return (
          <div key={w.id} className="flex items-center justify-between gap-2 text-xs opacity-95">
            <span className="truncate">• {w.messageFr}</span>
            {sol && onAutoFitModule && (
              <button
                type="button"
                data-testid={`banner-autofit-${w.moduleId}`}
                onClick={() => onAutoFitModule(w.moduleId)}
                title={sol.summaryFr}
                className="shrink-0 rounded border border-emerald-400/60 bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30"
              >
                Ajuster ({sol.summaryFr})
              </button>
            )}
          </div>
        );
      })}
      {warnings.length > 3 && (
        <div className="text-xs opacity-80">
          + {warnings.length - 3} autre(s) alerte(s)
        </div>
      )}
    </div>
  );
}
