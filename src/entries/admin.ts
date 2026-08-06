import process from 'node:process';

import { AdminService } from '../application/admin-service.js';
import { loadAdminConfig, loadVdsConfig } from '../config.js';
import { basicAuth } from '../infrastructure/http/basic-auth.js';
import { createAdminServer } from '../infrastructure/http/admin-server.js';
import { ConsoleLogger } from '../infrastructure/runtime/logger.js';
import { SqliteAdminRepository } from '../infrastructure/sqlite/admin-repository.js';
import { createVdsRuntime, type RuntimeOverrides } from '../runtime/composition.js';

export async function runAdmin(
  signal: AbortSignal,
  environment: NodeJS.ProcessEnv,
  overrides: RuntimeOverrides = {}
): Promise<void> {
  const adminConfig = loadAdminConfig(environment);
  const logger = overrides.logger ?? new ConsoleLogger();
  const runtime = createVdsRuntime(loadVdsConfig(environment), { ...overrides, logger });
  const adminService = new AdminService(new SqliteAdminRepository(runtime.database));
  const app = createAdminServer({
    adminService,
    auth: basicAuth(adminConfig.username, adminConfig.password),
    logger,
    runSync: async () => {
      await runtime.ensureInitialSource();
      return runtime.syncJob.execute();
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const server = app.listen(adminConfig.port, adminConfig.host, () => {
      logger.info('admin_server_started', { host: adminConfig.host, port: adminConfig.port });
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
  await runAdmin(controller.signal, process.env);
} catch (error: unknown) {
  console.error('admin_start_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError'
  });
  process.exitCode = 1;
}
