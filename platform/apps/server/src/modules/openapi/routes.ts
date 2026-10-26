import { Hono } from 'hono';
import { z } from 'zod';
import { owner, paramId, type ApiEnv } from '../../shared/http.js';
import type { Services } from '../../services.js';
import { previewOpenApi } from './importService.js';
import { withExecution } from '../mcp/executionContext.js';
import { AppError } from '../../shared/errors.js';
export function openApiRoutes(services: Services) {
  const app = new Hono<ApiEnv>();
  app.post('/openapi/preview', async (c) =>
    c.json(
      await previewOpenApi({
        ownerId: owner(c),
        value: await c.req.json(),
        artifacts: services.artifacts,
        fetch,
      }),
    ),
  );
  app.use('/connections/:id/bindings/:bindingId/openapi/*', async (c, next) => {
    await services.connections.owned(owner(c), paramId(c));
    const binding = (await services.connections.bindings.list(owner(c), paramId(c))).find(
      (row) => row.id === c.req.param('bindingId'),
    );
    if (!binding) throw new AppError('NOT_FOUND', '授权绑定不存在', 404);
    await withExecution(
      {
        identity: binding.identity,
        entry: 'dashboard',
        sessionId: 'authorization',
        capabilities: {},
      },
      next,
    );
  });
  for (const prefix of [
    '/connections/:id/openapi/oauth/:scheme',
    '/connections/:id/bindings/:bindingId/openapi/oauth/:scheme',
  ]) {
    app.get(prefix, async (c) =>
      c.json(
        await services.apiOAuth.status(
          await services.connections.context(owner(c), paramId(c)),
          z.string().min(1).parse(c.req.param('scheme')),
        ),
      ),
    );
    app.delete(prefix, async (c) => {
      const context = await services.connections.context(owner(c), paramId(c));
      await services.connections.closeBinding(context);
      return c.json(
        await services.apiOAuth.revoke(context, z.string().min(1).parse(c.req.param('scheme'))),
      );
    });
    app.post(`${prefix}/start`, async (c) =>
      c.json(
        await services.apiOAuth.start(
          await services.connections.context(owner(c), paramId(c)),
          z.string().min(1).parse(c.req.param('scheme')),
        ),
      ),
    );
    app.get(`${prefix}/callback`, async (c) =>
      c.json(
        await services.apiOAuth.complete(
          await services.connections.context(owner(c), paramId(c)),
          z.string().min(1).parse(c.req.param('scheme')),
          z
            .object({
              code: z.string().min(1),
              state: z.string().min(1),
              iss: z.string().optional(),
            })
            .transform((v) => ({ code: v.code, state: v.state, issuer: v.iss }))
            .parse(c.req.query()),
        ),
      ),
    );
  }
  return app;
}
