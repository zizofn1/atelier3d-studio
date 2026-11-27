/**
 * Registers the offline Service Worker (`/sw.js`) in production builds so
 * Atelier3D Studio works 100% offline on iPad, mobile, and desktop after first visit.
 */
export function registerOfflineServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if ('happyDOM' in window || !('serviceWorker' in navigator)) return;

  const register = () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Non-blocking in restricted WebViews or private browsing contexts
    });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
