/// <reference lib="webworker" />
import { parseHealthExport, type ParseProgress } from './exportXml';
import type { HealthDay } from '../domain/types';

export type ExportWorkerRequest = { file: File };

export type ExportWorkerResponse =
  | { type: 'progress'; progress: ParseProgress }
  | { type: 'done'; days: Array<{ d: string } & HealthDay>; records: number }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<ExportWorkerRequest>) => {
  try {
    let records = 0;
    const days = await parseHealthExport(e.data.file, (progress) => {
      records = progress.records;
      ctx.postMessage({ type: 'progress', progress } satisfies ExportWorkerResponse);
    });
    ctx.postMessage({ type: 'done', days, records } satisfies ExportWorkerResponse);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ExportWorkerResponse);
  }
};
