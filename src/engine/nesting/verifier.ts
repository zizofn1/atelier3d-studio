import type { NestingConfig, NestingPieceInput, NestingRunResult } from '@/types';
import { roundMm } from '@/utils/units';

export interface NestingVerificationReport {
  ok: boolean;
  errorsFr: string[];
}

const TOL = 1e-3;

export function verifyNestingResult(
  result: NestingRunResult,
  config: NestingConfig,
  inputPieces?: NestingPieceInput[]
): NestingVerificationReport {
  const errorsFr: string[] = [];
  const minX = Math.max(0, config.trimLeftMm);
  const minY = Math.max(0, config.trimTopMm);
  const maxX = config.sheet.widthMm - Math.max(0, config.trimRightMm);
  const maxY = config.sheet.heightMm - Math.max(0, config.trimBottomMm);
  const kerf = Math.max(0, config.kerfMm);

  const inputMap = new Map<string, NestingPieceInput>();
  if (inputPieces) {
    for (const p of inputPieces) {
      inputMap.set(p.id, p);
    }
  }

  const seenIds = new Set<string>();
  let totalSheetsCount = 0;
  let totalUsedAll = 0;

  for (const group of result.groups) {
    let groupUsed = 0;

    for (const sheet of group.sheets) {
      totalSheetsCount++;
      const sheetArea = sheet.sheetWidthMm * sheet.sheetHeightMm;
      let sheetUsed = 0;

      for (let i = 0; i < sheet.placements.length; i++) {
        const p = sheet.placements[i];

        if (seenIds.has(p.pieceId)) {
          errorsFr.push(`Pièce dupliquée dans le calepinage : ${p.pieceId}`);
        }
        seenIds.add(p.pieceId);

        // Bounds check with trim
        if (p.xMm < minX - TOL || p.yMm < minY - TOL) {
          errorsFr.push(
            `Pièce ${p.pieceId} hors marge de délignage (x=${p.xMm}, y=${p.yMm}, min=${minX}/${minY}).`
          );
        }
        if (p.xMm + p.widthMm > maxX + TOL || p.yMm + p.heightMm > maxY + TOL) {
          errorsFr.push(
            `Pièce ${p.pieceId} dépasse les limites utiles de la feuille (${maxX}×${maxY} mm).`
          );
        }

        // Grain-lock & dimension consistency check
        if (config.respectGrain && p.grain !== 'none' && p.rotated) {
          errorsFr.push(
            `Violation du sens du fil sur la pièce ${p.pieceId} (rotation 90° interdite).`
          );
        }

        const orig = inputMap.get(p.pieceId);
        if (orig) {
          const expectedW = p.rotated ? orig.heightMm : orig.widthMm;
          const expectedH = p.rotated ? orig.widthMm : orig.heightMm;
          if (Math.abs(p.widthMm - expectedW) > TOL || Math.abs(p.heightMm - expectedH) > TOL) {
            errorsFr.push(
              `Dimensions incohérentes pour la pièce ${p.pieceId} : placé ${p.widthMm}×${p.heightMm}, attendu ${expectedW}×${expectedH}.`
            );
          }
          const expEdges = p.rotated
            ? {
                top: orig.edges.left,
                bottom: orig.edges.right,
                left: orig.edges.top,
                right: orig.edges.bottom,
              }
            : orig.edges;
          if (
            p.edges.top !== expEdges.top ||
            p.edges.bottom !== expEdges.bottom ||
            p.edges.left !== expEdges.left ||
            p.edges.right !== expEdges.right
          ) {
            errorsFr.push(
              `Orientation des chants incohérente pour la pièce ${p.pieceId} (rotation=${String(p.rotated)}).`
            );
          }
        }

        // Pairwise non-overlap + kerf clearance check
        for (let j = i + 1; j < sheet.placements.length; j++) {
          const q = sheet.placements[j];
          const sepX = Math.max(q.xMm - (p.xMm + p.widthMm), p.xMm - (q.xMm + q.widthMm));
          const sepY = Math.max(q.yMm - (p.yMm + p.heightMm), p.yMm - (q.yMm + q.heightMm));

          if (sepX < -TOL && sepY < -TOL) {
            errorsFr.push(
              `Chevauchement détecté entre ${p.pieceId} et ${q.pieceId} sur la feuille ${sheet.sheetIndex + 1}.`
            );
          } else if (Math.max(sepX, sepY) < kerf - TOL) {
            errorsFr.push(
              `Trait de scie insuffisant (${roundMm(Math.max(sepX, sepY), 2)} mm < ${kerf} mm) entre ${p.pieceId} et ${q.pieceId}.`
            );
          }
        }

        sheetUsed += p.widthMm * p.heightMm;
      }

      if (Math.abs(sheet.usedAreaMm2 - sheetUsed) > 1) {
        errorsFr.push(
          `Surface utilisée incohérente sur la feuille ${sheet.sheetIndex + 1} (${sheet.usedAreaMm2} vs ${roundMm(sheetUsed, 2)}).`
        );
      }

      const expectedWaste =
        sheetArea > 0 ? roundMm(((sheetArea - Math.min(sheetArea, sheetUsed)) / sheetArea) * 100, 2) : 0;
      if (Math.abs(sheet.wastePercent - expectedWaste) > 0.05) {
        errorsFr.push(
          `Taux de chute incohérent sur la feuille ${sheet.sheetIndex + 1} (${sheet.wastePercent}% vs ${expectedWaste}%).`
        );
      }

      groupUsed += sheetUsed;
    }

    for (const unplacedId of group.unplacedPieceIds) {
      if (seenIds.has(unplacedId)) {
        errorsFr.push(`Pièce ${unplacedId} marquée à la fois placée et non placée.`);
      }
      seenIds.add(unplacedId);
    }

    totalUsedAll += groupUsed;
  }

  if (totalSheetsCount !== result.totalSheets) {
    errorsFr.push(
      `Nombre total de feuilles incohérent (${result.totalSheets} vs ${totalSheetsCount}).`
    );
  }

  const totalSheetArea = totalSheetsCount * config.sheet.widthMm * config.sheet.heightMm;
  const expectedOverallWaste =
    totalSheetArea > 0
      ? roundMm(((totalSheetArea - Math.min(totalSheetArea, totalUsedAll)) / totalSheetArea) * 100, 2)
      : 0;
  if (Math.abs(result.overallWastePercent - expectedOverallWaste) > 0.05) {
    errorsFr.push(
      `Taux de chute global incohérent (${result.overallWastePercent}% vs ${expectedOverallWaste}%).`
    );
  }

  if (inputPieces) {
    for (const p of inputPieces) {
      if (!seenIds.has(p.id)) {
        errorsFr.push(`Pièce d'entrée manquante dans le résultat du calepinage : ${p.id}`);
      }
    }
    if (seenIds.size !== inputPieces.length) {
      errorsFr.push(
        `Nombre total de pièces traitées incohérent (${seenIds.size} vs ${inputPieces.length}).`
      );
    }
  }

  return {
    ok: errorsFr.length === 0,
    errorsFr,
  };
}
