export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Keep blob URL alive 60s so iOS / iPadOS Safari's async "Télécharger ?" confirmation sheet never fails
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

export function canNativeShareFiles(files?: File[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (files && typeof navigator.canShare === 'function') {
    try {
      return navigator.canShare({ files });
    } catch {
      return false;
    }
  }
  return typeof navigator.canShare === 'function';
}

/**
 * Shares a generated file via native iOS/iPadOS/Android Web Share API (ideal for WhatsApp / AirDrop)
 * and automatically falls back to standard browser download on Desktop or unsupported browsers.
 */
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  options?: { title?: string; text?: string }
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (typeof File !== 'undefined' && canNativeShareFiles()) {
    try {
      const file = new File([blob], filename, {
        type: blob.type || 'application/octet-stream',
      });
      if (canNativeShareFiles([file])) {
        await navigator.share({
          files: [file],
          title: options?.title ?? filename,
          text: options?.text,
        });
        return 'shared';
      }
    } catch (err) {
      // User closed the share sheet voluntarily: do not duplicate with a download
      if (err instanceof Error && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  triggerBlobDownload(blob, filename);
  return 'downloaded';
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  triggerBlobDownload(blob, filename);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
