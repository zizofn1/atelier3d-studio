/**
 * Lightweight no-op stub replacing optional jsPDF HTML/DOM dependencies
 * (`html2canvas`, `canvg`, `dompurify`) that are never used by Atelier3D's
 * native vector PDF engine. Saves ~380 kB from the production bundle.
 */
export default function unusedOptionalDep(): never {
  throw new Error('Dépendance optionnelle HTML non utilisée par le moteur PDF vectoriel.');
}

export const Canvg = {
  from: () => Promise.reject(new Error('Canvg non utilisé.')),
  fromString: () => Promise.reject(new Error('Canvg non utilisé.')),
};
