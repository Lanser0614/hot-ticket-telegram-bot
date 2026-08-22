import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Response,
  Router
} from 'express';

import type {
  AdminScope,
  AdminService,
  AdminSort,
  AdminQuery,
  AdminTripFilter,
  SortDirection
} from '../../application/admin-service.js';
import type { Logger } from '../../application/ports.js';
import { renderAdminPage } from '../../presentation/admin-page.js';

export interface AdminServerDependencies {
  readonly adminService: AdminService;
  readonly runSync: () => Promise<{ processedSources: number }>;
  readonly auth: RequestHandler;
  readonly logger: Logger;
}

const ADMIN_BASE_PATH = '/admin';

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function parseScope(value: string): AdminScope {
  return value === 'domestic' || value === 'international' ? value : 'all';
}

function parseTrip(value: string): AdminTripFilter {
  return value === 'round' || value === 'oneway' ? value : 'all';
}

function parseSort(value: string): AdminSort {
  return value === 'price' || value === 'date' ? value : 'city';
}

function parseDirection(value: string): SortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}

function parsePage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : '';
}

function parseQuery(request: Request): AdminQuery {
  return {
    scope: parseScope(firstValue(request.query.scope)),
    trip: parseTrip(firstValue(request.query.trip)),
    date: parseDate(firstValue(request.query.date)),
    returnDate: parseDate(firstValue(request.query.rdate)),
    sort: parseSort(firstValue(request.query.sort)),
    direction: parseDirection(firstValue(request.query.dir)),
    search: firstValue(request.query.q).slice(0, 100),
    page: parsePage(firstValue(request.query.page))
  };
}

export function createAdminServer(dependencies: AdminServerDependencies): Express {
  const app = express();
  const admin = Router();
  app.disable('x-powered-by');

  app.get('/healthz', (_request: Request, response: Response) => {
    response.type('text/plain').send('ok');
  });

  app.get('/', (_request: Request, response: Response) => {
    response.redirect(`${ADMIN_BASE_PATH}/`);
  });

  admin.use(dependencies.auth);

  admin.get('/', async (request: Request, response: Response) => {
    try {
      const dashboard = await dependencies.adminService.getDashboard(parseQuery(request));
      const flash = firstValue(request.query.flash);
      response.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      response.set('Pragma', 'no-cache');
      response.type('text/html; charset=utf-8').send(
        renderAdminPage(dashboard, flash.length === 0 ? undefined : flash, ADMIN_BASE_PATH)
      );
    } catch (error: unknown) {
      dependencies.logger.error('admin_dashboard_failed', {
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      });
      response.status(500).type('text/plain; charset=utf-8').send('Внутренняя ошибка');
    }
  });

  admin.post('/sync', async (_request: Request, response: Response) => {
    try {
      const result = await dependencies.runSync();
      const flash = `Синхронизация завершена. Обработано источников: ${result.processedSources}.`;
      response.redirect(`${ADMIN_BASE_PATH}/?flash=${encodeURIComponent(flash)}`);
    } catch (error: unknown) {
      dependencies.logger.error('admin_manual_sync_failed', {
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      });
      response.redirect(
        `${ADMIN_BASE_PATH}/?flash=${encodeURIComponent('Не удалось запустить синхронизацию.')}`
      );
    }
  });

  app.use(ADMIN_BASE_PATH, admin);

  return app;
}
