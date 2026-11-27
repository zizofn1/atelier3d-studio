import { pauseHistory, resumeHistory } from '@/store/useProjectStore';

let continuousActive = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesces high-frequency continuous edits (HTML5 <input type="color"> or <input type="range"> drags)
 * into a SINGLE Undo/Redo history entry instead of flooding Zundo's 50-state stack.
 *
 * The first edit executes while history is active (capturing the exact pre-drag state in pastStates),
 * then history is paused for subsequent rapid ticks until 400 ms of idle or explicit flush.
 */
export function runContinuousEdit(editFn: () => void, idleMs = 400): void {
  if (!continuousActive) {
    editFn();
    pauseHistory();
    continuousActive = true;
  } else {
    editFn();
  }

  if (idleTimer !== null) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    flushContinuousEdit();
  }, idleMs);
}

export function flushContinuousEdit(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (continuousActive) {
    continuousActive = false;
    resumeHistory();
  }
}
