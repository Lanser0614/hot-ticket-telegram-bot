import process from 'node:process';

import { loadVdsConfig } from '../config.js';
import { createVdsRuntime, type RuntimeOverrides } from '../runtime/composition.js';

export async function runSync(
  environment: NodeJS.ProcessEnv,
  overrides: RuntimeOverrides = {}
): Promise<{ processedSources: number }> {
  const runtime = createVdsRuntime(loadVdsConfig(environment), overrides);
  try {
    await runtime.ensureInitialSource();
    return await runtime.syncJob.execute();
  } finally {
    runtime.close();
  }
}

try {
  const result = await runSync(process.env);
  console.info(JSON.stringify(result));
} catch (error: unknown) {
  console.error('ticket_sync_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError'
  });
  process.exitCode = 1;
}
