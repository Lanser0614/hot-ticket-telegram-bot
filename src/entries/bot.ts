import process from 'node:process';

import { loadVdsConfig } from '../config.js';
import { createVdsRuntime, type RuntimeOverrides } from '../runtime/composition.js';

export async function runBot(
  signal: AbortSignal,
  environment: NodeJS.ProcessEnv,
  overrides: RuntimeOverrides = {}
): Promise<void> {
  const runtime = createVdsRuntime(loadVdsConfig(environment), overrides);
  try {
    await runtime.telegram.deleteWebhook();
    await runtime.polling.run(signal);
  } finally {
    runtime.close();
  }
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

try {
  await runBot(controller.signal, process.env);
} catch (error: unknown) {
  console.error('bot_start_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError'
  });
  process.exitCode = 1;
}
