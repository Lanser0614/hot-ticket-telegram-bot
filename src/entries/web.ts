import process from 'node:process';
import { resolve } from 'node:path';

import { MiniAppService } from '../application/miniapp.js';
import { SubscriptionService } from '../application/subscriptions.js';
import { loadVdsConfig, loadWebConfig } from '../config.js';
import { createWebServer } from '../infrastructure/http/web-server.js';
import { createVdsRuntime, type RuntimeOverrides } from '../runtime/composition.js';

export async function runWeb(
  signal: AbortSignal,
  environment: NodeJS.ProcessEnv,
  overrides: RuntimeOverrides = {}
): Promise<void> {
  const vdsConfig = loadVdsConfig(environment);
  const webConfig = loadWebConfig(environment);
  const runtime = createVdsRuntime(vdsConfig, overrides);
  const subscriptions = new SubscriptionService(
    runtime.repositories,
    runtime.repositories,
    runtime.clock
  );
  const miniApp = new MiniAppService(
    runtime.repositories,
    runtime.repositories,
    runtime.repositories,
    subscriptions,
    runtime.links,
    runtime.clock,
    runtime.repositories,
    runtime.referrals
  );
  const app = createWebServer({
    miniApp,
    tickets: runtime.repositories,
    clicks: runtime.repositories,
    routePrices: runtime.repositories,
    subscriptions: runtime.repositories,
    clock: runtime.clock,
    logger: runtime.logger,
    telegramBotToken: vdsConfig.telegramBotToken,
    authMaxAgeSeconds: webConfig.authMaxAgeSeconds,
    clickSigningSecret: vdsConfig.tracking.clickSigningSecret,
    affiliate: {
      marker: vdsConfig.tracking.affiliateMarker,
      template: vdsConfig.tracking.affiliateLinkTemplate
    },
    staticDirectory: resolve('webapp')
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const server = app.listen(webConfig.port, webConfig.host, () => {
      runtime.logger.info('web_server_started', {
        host: webConfig.host,
        port: webConfig.port
      });
    });
    server.on('error', rejectListen);
    signal.addEventListener('abort', () => {
      server.close(() => resolveListen());
    }, { once: true });
  });
  runtime.close();
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

try {
  await runWeb(controller.signal, process.env);
} catch (error: unknown) {
  console.error('web_start_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError'
  });
  process.exitCode = 1;
}
