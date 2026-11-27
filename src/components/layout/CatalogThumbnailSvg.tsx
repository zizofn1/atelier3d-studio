import type { ModuleType, ScenePropType } from '@/types';

interface CatalogThumbnailSvgProps {
  kind: 'module' | 'prop';
  type: ModuleType | ScenePropType;
  size?: number;
}

/**
 * Renders a crisp parametric isometric SVG preview for any carpentry module or appliance/decor item
 * (100% offline, zero external assets, instant recognition before placement).
 */
export function CatalogThumbnailSvg({ kind, type, size = 34 }: CatalogThumbnailSvgProps) {
  // Base isometric box helper coordinates (64x64 viewBox)
  const renderModule = (t: ModuleType) => {
    const isTall =
      t === 'colonne' ||
      t === 'colonne_garde_manger' ||
      t === 'colonne_mixte_tiroirs_portes' ||
      t === 'meuble_vitrine' ||
      t === 'colonne_sdb' ||
      t === 'meuble_buanderie' ||
      t === 'dressing_penderie' ||
      t === 'dressing_etagere' ||
      t === 'dressing_tiroirs' ||
      t === 'portes_battantes' ||
      t === 'portes_coulissantes' ||
      t === 'bibliotheque';
    const isFlat = t === 'plan_de_travail' || t === 'plinthe' || t === 'credence';
    const isLow = t === 'meuble_tv' || t === 'banc_entree' || t === 'bureau';
    const isWallUpper =
      t === 'caisson_haut' ||
      t === 'meuble_haut_vitre' ||
      t === 'caisson_haut_angle' ||
      t === 'caisson_haut_angle_aveugle' ||
      t === 'caisson_sur_frigo' ||
      t === 'caisson_haut_relevant' ||
      t === 'armoire_miroir_led' ||
      t === 'meuble_vasque' ||
      t === 'meuble_double_vasque';

    const topY = isTall ? 7 : isFlat ? 26 : isLow ? 22 : isWallUpper ? 14 : 16;
    const botY = isTall ? 57 : isFlat ? 36 : isLow ? 50 : isWallUpper ? 46 : 54;
    const leftX = t === 'colonne_sdb' ? 20 : 12;
    const rightX = t === 'colonne_sdb' ? 44 : 52;
    const midX = (leftX + rightX) / 2;
    const depthShiftX = 8;
    const depthShiftY = 6;

    const frontFill =
      t === 'armoire_miroir_led'
        ? '#cbd5e1'
        : t === 'meuble_haut_vitre' || t === 'meuble_vitrine'
          ? '#7dd3fc'
          : t === 'meuble_vasque' || t === 'meuble_double_vasque'
            ? '#d6bfa2'
            : t === 'plan_de_travail'
              ? '#94a3b8'
              : '#c89d6c';

    return (
      <>
        {/* Top isometric face */}
        <polygon
          points={`${leftX},${topY + depthShiftY} ${leftX + depthShiftX},${topY} ${rightX + depthShiftX - 4},${topY} ${rightX - 4},${topY + depthShiftY}`}
          fill="#e2c7a4"
          stroke="#0f172a"
          strokeWidth="1.4"
        />
        {/* Right side face */}
        <polygon
          points={`${rightX - 4},${topY + depthShiftY} ${rightX + depthShiftX - 4},${topY} ${rightX + depthShiftX - 4},${botY - depthShiftY} ${rightX - 4},${botY}`}
          fill="#9c7548"
          stroke="#0f172a"
          strokeWidth="1.4"
        />
        {/* Front facade face */}
        <rect
          x={leftX}
          y={topY + depthShiftY}
          width={rightX - 4 - leftX}
          height={botY - (topY + depthShiftY)}
          fill={frontFill}
          stroke="#0f172a"
          strokeWidth="1.5"
          rx="1"
        />

        {/* Specific architectural details per module type */}
        {(t === 'caisson_casserolier' ||
          t === 'dressing_tiroirs' ||
          t === 'meuble_vasque' ||
          t === 'meuble_double_vasque') && (
          <>
            <line x1={leftX + 2} y1={(topY + depthShiftY + botY) / 2} x2={rightX - 6} y2={(topY + depthShiftY + botY) / 2} stroke="#0f172a" strokeWidth="1.3" />
            {t === 'caisson_casserolier' && (
              <line x1={leftX + 2} y1={topY + depthShiftY + (botY - topY - depthShiftY) * 0.33} x2={rightX - 6} y2={topY + depthShiftY + (botY - topY - depthShiftY) * 0.33} stroke="#0f172a" strokeWidth="1.2" />
            )}
            {t === 'meuble_double_vasque' && (
              <line x1={midX - 2} y1={topY + depthShiftY} x2={midX - 2} y2={botY} stroke="#0f172a" strokeWidth="1.3" />
            )}
          </>
        )}

        {(t === 'meuble_vasque' || t === 'meuble_double_vasque') && (
          <>
            <ellipse
              cx={t === 'meuble_double_vasque' ? leftX + 12 : midX}
              cy={topY + 3}
              rx={t === 'meuble_double_vasque' ? 5.5 : 8}
              ry="3.5"
              fill="#ffffff"
              stroke="#475569"
              strokeWidth="1.2"
            />
            {t === 'meuble_double_vasque' && (
              <ellipse cx={rightX - 10} cy={topY + 3} rx="5.5" ry="3.5" fill="#ffffff" stroke="#475569" strokeWidth="1.2" />
            )}
          </>
        )}

        {(t === 'caisson_bas' ||
          t === 'caisson_sous_evier' ||
          t === 'caisson_haut' ||
          t === 'meuble_haut_vitre' ||
          t === 'portes_battantes' ||
          t === 'portes_coulissantes' ||
          t === 'colonne_garde_manger' ||
          t === 'armoire_miroir_led') && (
          <line
            x1={(leftX + rightX - 4) / 2}
            y1={topY + depthShiftY + 1}
            x2={(leftX + rightX - 4) / 2}
            y2={botY - 1}
            stroke="#0f172a"
            strokeWidth="1.3"
          />
        )}

        {(t === 'meuble_haut_vitre' || t === 'meuble_vitrine') && (
          <>
            <rect x={leftX + 3} y={topY + depthShiftY + 3} width={13} height={botY - topY - depthShiftY - 6} fill="#e0f2fe" fillOpacity="0.6" stroke="#334155" strokeWidth="1" />
            <rect x={leftX + 20} y={topY + depthShiftY + 3} width={13} height={botY - topY - depthShiftY - 6} fill="#e0f2fe" fillOpacity="0.6" stroke="#334155" strokeWidth="1" />
          </>
        )}

        {(t === 'caisson_bas_tiroir_porte' ||
          t === 'caisson_bas_2tiroirs_porte' ||
          t === 'colonne_mixte_tiroirs_portes') && (
          <>
            <line x1={leftX + 2} y1={topY + depthShiftY + 11} x2={rightX - 6} y2={topY + depthShiftY + 11} stroke="#0f172a" strokeWidth="1.3" />
            <line x1={(leftX + rightX - 4) / 2} y1={topY + depthShiftY + 11} x2={(leftX + rightX - 4) / 2} y2={botY - 1} stroke="#0f172a" strokeWidth="1.2" />
          </>
        )}

        {(t === 'caisson_angle_pan_coupe' || t === 'caisson_haut_angle') && (
          <line x1={leftX + 8} y1={topY + depthShiftY} x2={rightX - 10} y2={botY} stroke="#0f172a" strokeWidth="1.4" strokeDasharray="3 2" />
        )}

        {(t === 'caisson_angle_aveugle' || t === 'caisson_haut_angle_aveugle') && (
          <>
            <rect x={leftX + 1} y={topY + depthShiftY + 1} width={14} height={botY - topY - depthShiftY - 2} fill="#94a3b8" fillOpacity="0.45" />
            <line x1={leftX + 15} y1={topY + depthShiftY + 1} x2={leftX + 15} y2={botY - 1} stroke="#0f172a" strokeWidth="1.4" />
          </>
        )}

        {t === 'colonne' && (
          <rect x={leftX + 4} y={24} width={rightX - 4 - leftX - 8} height={14} fill="#1e293b" stroke="#cbd5e1" strokeWidth="1.2" rx="1" />
        )}

        {t === 'meuble_buanderie' && (
          <>
            <rect x={leftX + 4} y={35} width={rightX - 4 - leftX - 8} height={19} fill="#e2e8f0" stroke="#334155" strokeWidth="1.1" />
            <circle cx={(leftX + rightX - 4) / 2} cy={45} r="6" fill="#334155" stroke="#94a3b8" strokeWidth="1.4" />
          </>
        )}

        {(t === 'bibliotheque' || t === 'dressing_etagere') && (
          <>
            {[0.25, 0.5, 0.75].map((f) => {
              const y = topY + depthShiftY + (botY - topY - depthShiftY) * f;
              return <line key={f} x1={leftX + 2} y1={y} x2={rightX - 6} y2={y} stroke="#475569" strokeWidth="1.3" />;
            })}
          </>
        )}

        {t === 'armoire_miroir_led' && (
          <line x1={leftX + 3} y1={topY + depthShiftY + 2} x2={rightX - 7} y2={topY + depthShiftY + 2} stroke="#fde68a" strokeWidth="2.2" />
        )}

        {t === 'dressing_penderie' && (
          <line x1={leftX + 3} y1={22} x2={rightX - 7} y2={22} stroke="#e2e8f0" strokeWidth="2.2" />
        )}
      </>
    );
  };

  const renderProp = (t: ScenePropType) => {
    switch (t) {
      case 'refrigerateur':
      case 'refrigerateur_americain':
        return (
          <>
            <rect x={t === 'refrigerateur_americain' ? 12 : 18} y={8} width={t === 'refrigerateur_americain' ? 40 : 28} height={48} rx="2" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.6" />
            {t === 'refrigerateur_americain' ? (
              <>
                <line x1={32} y1={9} x2={32} y2={55} stroke="#0f172a" strokeWidth="1.5" />
                <rect x={16} y={21} width={10} height={14} rx="1" fill="#1e293b" />
                <line x1={29} y1={16} x2={29} y2={42} stroke="#475569" strokeWidth="1.8" />
                <line x1={35} y1={16} x2={35} y2={42} stroke="#475569" strokeWidth="1.8" />
              </>
            ) : (
              <>
                <line x1={19} y1={37} x2={45} y2={37} stroke="#0f172a" strokeWidth="1.5" />
                <line x1={22} y1={18} x2={22} y2={33} stroke="#475569" strokeWidth="1.8" />
                <line x1={22} y1={41} x2={22} y2={51} stroke="#475569" strokeWidth="1.8" />
              </>
            )}
          </>
        );
      case 'plaque_cuisson':
        return (
          <>
            <rect x={10} y={16} width={44} height={32} rx="2" fill="#1e293b" stroke="#64748b" strokeWidth="1.6" />
            <circle cx={22} cy={26} r="6.5" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <circle cx={42} cy={26} r="5.5" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <circle cx={22} cy={39} r="5" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <circle cx={42} cy={39} r="6" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1={24} y1={45} x2={40} y2={45} stroke="#ef4444" strokeWidth="1.8" />
          </>
        );
      case 'hotte_aspirante':
        return (
          <>
            <rect x={25} y={8} width={14} height={24} fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.5" />
            <polygon points="10,46 54,46 46,32 18,32" fill="#e2e8f0" stroke="#0f172a" strokeWidth="1.5" />
            <circle cx={22} cy={49} r="2.2" fill="#fde68a" />
            <circle cx={42} cy={49} r="2.2" fill="#fde68a" />
          </>
        );
      case 'evier_mitigeur':
        return (
          <>
            <rect x={10} y={22} width={44} height={28} rx="2" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.5" />
            <rect x={14} y={26} width={20} height={20} rx="2" fill="#64748b" stroke="#334155" strokeWidth="1.2" />
            <line x1={38} y1={28} x2={50} y2={28} stroke="#475569" strokeWidth="1.4" />
            <line x1={38} y1={34} x2={50} y2={34} stroke="#475569" strokeWidth="1.4" />
            <line x1={38} y1={40} x2={50} y2={40} stroke="#475569" strokeWidth="1.4" />
            <path d="M 24 26 L 24 14 Q 24 9 30 14" fill="none" stroke="#e2e8f0" strokeWidth="2.4" />
          </>
        );
      case 'lave_vaisselle':
      case 'four_encastrable':
      case 'micro_ondes':
        return (
          <>
            <rect x={12} y={t === 'micro_ondes' ? 18 : 12} width={40} height={t === 'micro_ondes' ? 28 : 40} rx="2" fill={t === 'lave_vaisselle' ? '#cbd5e1' : '#1e293b'} stroke="#64748b" strokeWidth="1.6" />
            <rect x={16} y={t === 'micro_ondes' ? 23 : 22} width={t === 'micro_ondes' ? 24 : 32} height={t === 'micro_ondes' ? 18 : 24} rx="1" fill="#0f172a" stroke="#94a3b8" strokeWidth="1.2" />
            <line x1={18} y1={t === 'micro_ondes' ? 21 : 17} x2={46} y2={t === 'micro_ondes' ? 21 : 17} stroke="#38bdf8" strokeWidth="2" />
          </>
        );
      case 'machine_laver':
      case 'seche_linge':
        return (
          <>
            <rect x={12} y={10} width={40} height={44} rx="2.5" fill="#f1f5f9" stroke="#334155" strokeWidth="1.6" />
            <line x1={13} y1={19} x2={51} y2={19} stroke="#64748b" strokeWidth="1.2" />
            <circle cx={32} cy={14.5} r="2.2" fill="#475569" />
            <line x1={40} y1={14.5} x2={47} y2={14.5} stroke="#38bdf8" strokeWidth="2" />
            <circle cx={32} cy={36} r="11" fill={t === 'seche_linge' ? '#0f172a' : '#334155'} stroke="#94a3b8" strokeWidth="2.4" />
            <circle cx={32} cy={36} r="6.5" fill="#1e293b" />
          </>
        );
      case 'machine_cafe':
        return (
          <>
            <rect x={18} y={12} width={28} height={38} rx="2" fill="#cbd5e1" stroke="#334155" strokeWidth="1.5" />
            <rect x={22} y={24} width={20} height={16} rx="1" fill="#1e293b" />
            <rect x={25} y={32} width={6} height={7} rx="1" fill="#f8fafc" />
            <rect x={33} y={32} width={6} height={7} rx="1" fill="#f8fafc" />
            <rect x={18} y={45} width={28} height={5} fill="#475569" />
          </>
        );
      case 'bouilloire_grille_pain':
        return (
          <>
            <rect x={10} y={28} width={22} height={20} rx="4" fill="#cbd5e1" stroke="#334155" strokeWidth="1.5" />
            <line x1={15} y1={28} x2={27} y2={28} stroke="#0f172a" strokeWidth="2" />
            <path d="M 38 48 L 40 22 L 50 22 L 52 48 Z" fill="#e2e8f0" stroke="#334155" strokeWidth="1.5" />
            <path d="M 50 26 Q 56 32 51 40" fill="none" stroke="#334155" strokeWidth="2" />
          </>
        );
      case 'chauffe_eau':
        return (
          <>
            <rect x={18} y={10} width={28} height={38} rx="4" fill="#f8fafc" stroke="#334155" strokeWidth="1.5" />
            <rect x={26} y={36} width={12} height={6} rx="1" fill="#0f172a" />
            <line x1={25} y1={48} x2={25} y2={56} stroke="#38bdf8" strokeWidth="2.2" />
            <line x1={39} y1={48} x2={39} y2={56} stroke="#ef4444" strokeWidth="2.2" />
          </>
        );
      case 'tableau_mural':
        return (
          <>
            <rect x={14} y={10} width={36} height={44} rx="1.5" fill="#f8fafc" stroke="#1e293b" strokeWidth="2.5" />
            <circle cx={28} cy={28} r="7" fill="#d97706" fillOpacity="0.7" />
            <polygon points="18,46 32,30 46,46" fill="#475569" fillOpacity="0.65" />
          </>
        );
      case 'etagere_murale':
        return (
          <>
            <rect x={10} y={38} width={44} height={6} rx="1" fill="#c59c6c" stroke="#334155" strokeWidth="1.4" />
            <rect x={16} y={22} width={5} height={16} fill="#64748b" />
            <rect x={22} y={25} width={5} height={13} fill="#d97706" />
            <circle cx={42} cy={31} r="6.5" fill="#e2e8f0" stroke="#475569" strokeWidth="1.2" />
          </>
        );
      case 'tele_ecran_plat':
        return (
          <>
            <rect x={8} y={14} width={48} height={30} rx="2" fill="#0f172a" stroke="#94a3b8" strokeWidth="1.8" />
            <line x1={14} y1={20} x2={34} y2={38} stroke="#38bdf8" strokeOpacity="0.35" strokeWidth="3" />
            <line x1={32} y1={44} x2={32} y2={51} stroke="#64748b" strokeWidth="3" />
            <line x1={21} y1={52} x2={43} y2={52} stroke="#94a3b8" strokeWidth="2.5" />
          </>
        );
      case 'suspension_lustre':
        return (
          <>
            <line x1={32} y1={6} x2={32} y2={24} stroke="#94a3b8" strokeWidth="1.8" />
            <path d="M 16 42 Q 32 18 48 42 Z" fill="#334155" stroke="#d4b06a" strokeWidth="1.6" />
            <circle cx={32} cy={43} r="5.5" fill="#fde68a" />
          </>
        );
      case 'applique_murale':
        return (
          <>
            <rect x={24} y={18} width={16} height={28} rx="4" fill="#c8a462" stroke="#0f172a" strokeWidth="1.5" />
            <polygon points="24,18 40,18 46,8 18,8" fill="#fde68a" fillOpacity="0.45" />
            <polygon points="24,46 40,46 46,56 18,56" fill="#fde68a" fillOpacity="0.45" />
          </>
        );
      case 'lampadaire_pied':
        return (
          <>
            <polygon points="20,24 44,24 40,10 24,10" fill="#fef3c7" stroke="#c8a462" strokeWidth="1.6" />
            <line x1={32} y1={24} x2={32} y2={54} stroke="#c8a462" strokeWidth="2.4" />
            <ellipse cx={32} cy={55} rx="11" ry="3" fill="#475569" />
          </>
        );
      case 'plante_pot':
        return (
          <>
            <polygon points="22,54 42,54 45,38 19,38" fill="#e6e1d8" stroke="#64748b" strokeWidth="1.5" />
            <circle cx={32} cy={25} r="10" fill="#4d8252" />
            <circle cx={23} cy={30} r="7" fill="#3f6e44" />
            <circle cx={41} cy={30} r="7" fill="#3f6e44" />
          </>
        );
      case 'tapis_deco':
        return (
          <>
            <polygon points="10,44 22,22 54,22 42,44" fill="#ded6c8" stroke="#94a3b8" strokeWidth="1.5" />
            <polygon points="16,40 25,26 48,26 39,40" fill="none" stroke="#a89e8e" strokeWidth="1.4" />
          </>
        );
      case 'canape_moderne':
        return (
          <>
            <rect x={9} y={24} width={46} height={22} rx="3" fill="#c8c0b4" stroke="#334155" strokeWidth="1.5" />
            <rect x={14} y={32} width={36} height={12} rx="2" fill="#dfd9cf" stroke="#475569" strokeWidth="1.2" />
            <line x1={14} y1={46} x2={14} y2={52} stroke="#64748b" strokeWidth="2.4" />
            <line x1={50} y1={46} x2={50} y2={52} stroke="#64748b" strokeWidth="2.4" />
          </>
        );
      case 'table_repas':
        return (
          <>
            <polygon points="8,28 18,18 56,18 46,28" fill="#c79e6e" stroke="#0f172a" strokeWidth="1.5" />
            <line x1={12} y1={28} x2={12} y2={50} stroke="#64748b" strokeWidth="2.4" />
            <line x1={44} y1={28} x2={44} y2={50} stroke="#64748b" strokeWidth="2.4" />
            <line x1={52} y1={20} x2={52} y2={42} stroke="#64748b" strokeWidth="2" />
          </>
        );
      case 'tabouret_bar':
      case 'chaise_moderne':
      default:
        return (
          <>
            <rect x={20} y={14} width={24} height={14} rx="2" fill="#c79e6e" stroke="#0f172a" strokeWidth="1.5" />
            <rect x={18} y={30} width={28} height={6} rx="2" fill="#d9c09c" stroke="#0f172a" strokeWidth="1.5" />
            <line x1={22} y1={36} x2={20} y2={55} stroke="#94a3b8" strokeWidth="2" />
            <line x1={42} y1={36} x2={44} y2={55} stroke="#94a3b8" strokeWidth="2" />
          </>
        );
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0 rounded border border-atelier-border bg-atelier-surface"
      aria-hidden="true"
    >
      {kind === 'module' ? renderModule(type as ModuleType) : renderProp(type as ScenePropType)}
    </svg>
  );
}
