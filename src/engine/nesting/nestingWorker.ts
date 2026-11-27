import type { NestingConfig, NestingPieceInput, NestingRunResult } from '@/types';
import { runGuillotineNesting } from './guillotine';

export interface NestingWorkerRequest {
  requestId: number;
  pieces: NestingPieceInput[];
  config: NestingConfig;
}

export interface NestingWorkerResponse {
  requestId: number;
  result: NestingRunResult;
}

self.addEventListener('message', (event: MessageEvent<NestingWorkerRequest>) => {
  const { requestId, pieces, config } = event.data;
  const result = runGuillotineNesting(pieces, config);
  const response: NestingWorkerResponse = { requestId, result };
  self.postMessage(response);
});
