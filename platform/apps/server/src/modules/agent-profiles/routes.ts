import { Hono } from 'hono';
import { owner, paramId, type ApiEnv } from '../../shared/http.js';
import type { ProfileService } from './profileService.js';
import type { InvocationService } from '../mcp/invocationService.js';
import type { Gateway } from '../mcp/gateway.js';
export function profileRoutes(deps: {
  profiles: ProfileService;
  invocations: InvocationService;
  gateway: Gateway;
  publicUrl: string;
}) {
  const app = new Hono<ApiEnv>();
  app.get('/', async (c) => c.json(await deps.profiles.list(owner(c))));
  app.post('/', async (c) => c.json(await deps.profiles.save(owner(c), await c.req.json()), 201));
  app.put('/:id', async (c) => {
    const profile = await deps.profiles.save(owner(c), await c.req.json(), paramId(c));
    deps.invocations.revoke({ profileId: paramId(c) });
    return c.json(profile);
  });
  app.post('/:id/keys', async (c) => {
    const key = await deps.profiles.issue(owner(c), paramId(c));
    return c.json(
      {
        ...key,
        config: {
          mcpServers: {
            platform: {
              type: 'http',
              url: `${deps.publicUrl}/mcp/${paramId(c)}`,
              headers: { Authorization: `Bearer ${key.token}` },
            },
          },
        },
      },
      201,
    );
  });
  app.get('/keys/all', async (c) => c.json(await deps.profiles.keys(owner(c))));
  app.delete('/keys/:id', async (c) => {
    await deps.profiles.revoke(owner(c), paramId(c));
    await deps.gateway.revoke(paramId(c));
    return c.json({ revoked: true });
  });
  return app;
}
