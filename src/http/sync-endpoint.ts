export interface SyncEndpointRequest {
  readonly method: string;
  readonly authorization: string | null;
}

export type SyncEndpointResponse =
  | {
      readonly statusCode: 200;
      readonly body: {
        readonly status: 'success';
        readonly processed_sources: number;
      };
    }
  | {
      readonly statusCode: 401 | 405 | 500;
      readonly body: {
        readonly status: 'error';
      };
    };

export interface SyncJob {
  execute(): Promise<{ readonly processedSources: number }>;
}

export interface SyncEndpointDependencies {
  readonly syncSecret: string;
  readonly job: SyncJob;
}

function constantTimeEquals(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export function createSyncEndpoint(dependencies: SyncEndpointDependencies) {
  const expectedAuthorization = `Bearer ${dependencies.syncSecret}`;

  return async (request: SyncEndpointRequest): Promise<SyncEndpointResponse> => {
    if (request.method.toUpperCase() !== 'POST') {
      return { statusCode: 405, body: { status: 'error' } };
    }

    if (
      request.authorization === null
      || !constantTimeEquals(request.authorization, expectedAuthorization)
    ) {
      return { statusCode: 401, body: { status: 'error' } };
    }

    try {
      const result = await dependencies.job.execute();
      return {
        statusCode: 200,
        body: {
          status: 'success',
          processed_sources: result.processedSources
        }
      };
    } catch {
      return { statusCode: 500, body: { status: 'error' } };
    }
  };
}
