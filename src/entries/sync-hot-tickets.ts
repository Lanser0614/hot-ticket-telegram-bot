import { createSyncRuntime } from '../platform/telegram/composition.js';

export default async function syncHotTickets(): Promise<{ processedSources: number }> {
  const runtime = createSyncRuntime();
  await runtime.ensureInitialSource();
  return runtime.job.execute();
}
