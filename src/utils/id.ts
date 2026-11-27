export function generateId(prefix = 'id'): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}_${uuid.slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nextModuleRef(modules: ReadonlyArray<{ ref: string }>): string {
  let maxNum = 0;
  for (const mod of modules) {
    const match = mod.ref.trim().match(/^M(\d+)$/i);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxNum) {
        maxNum = parsed;
      }
    }
  }
  const next = maxNum + 1;
  return `M${String(next).padStart(2, '0')}`;
}
