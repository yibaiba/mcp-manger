import { Hono } from 'hono';
import { callInput } from '@platform/contracts';
import { owner, paramId, type ApiEnv } from '../../shared/http.js';
import type { ConnectionService } from './connectionService.js';
import type { ProfileService } from '../agent-profiles/profileService.js';
import type { InvocationService } from './invocationService.js';
export function connectionRoutes(service: ConnectionService) {
  const app = new Hono<ApiEnv>();
  app.get('/', async (c) => c.json(await service.list(owner(c))));
  app.post('/', async (c) => c.json(await service.create(owner(c), await c.req.json()), 201));
  app.post('/:id/discover', async (c) =>
    c.json(await service.discover(owner(c), paramId(c), c.req.raw.signal)),
  );
  app.post('/:id/stop', async (c) => {
    await service.stop(owner(c), paramId(c));
    return c.json({ stopped: true });
  });
  return app;
}
export function toolRoutes(profiles: ProfileService, invocations: InvocationService) {
  const app = new Hono<ApiEnv>();
  app.get('/', async (c) => c.json(await profiles.catalog(owner(c))));
  app.post('/:toolId/call', async (c) => {
    const input = callInput.parse(await c.req.json());
    return c.json(
      await invocations.call({
        ownerId: owner(c),
        toolId: c.req.param('toolId'),
        arguments: input.arguments,
        signal: c.req.raw.signal,
      }),
    );
  });
  return app;
}
