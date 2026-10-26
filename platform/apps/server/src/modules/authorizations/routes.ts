import { Hono } from 'hono';
import { z } from 'zod';
import { owner, paramId, type ApiEnv } from '../../shared/http.js';
import type { ConnectionService } from '../mcp/connectionService.js';
import type { UpstreamOAuth } from './upstreamOAuth.js';
import type { PiService } from '../pi-runtime/piService.js';
import { AppError } from '../../shared/errors.js';
export function authorizationRoutes(deps: {
  connections: ConnectionService;
  oauth: UpstreamOAuth;
  pi: PiService;
}) {
  const app = new Hono<ApiEnv>();
  async function httpContext(ownerId: string, connectionId: string) {
    const context = await deps.connections.context(ownerId, connectionId);
    if (context.config.transport === 'stdio')
      throw new AppError(
        'OAUTH_NOT_APPLICABLE',
        'stdio 不使用上游 HTTP OAuth；请通过进程环境变量配置凭证',
      );
    return context;
  }
  app.get('/:id/oauth', async (c) => {
    const context = await httpContext(owner(c), paramId(c));
    return Response.json(
      context.config.adapter === 'pi'
        ? await deps.pi.action(context, { action: 'status' })
        : await deps.oauth.status(context),
    );
  });
  app.post('/:id/oauth/start', async (c) => {
    const context = await httpContext(owner(c), paramId(c));
    await deps.connections.close(owner(c), paramId(c));
    return Response.json(
      context.config.adapter === 'pi'
        ? await deps.pi.action(context, { action: 'auth-start' })
        : await deps.oauth.start(context),
    );
  });
  app.post('/:id/oauth/complete', async (c) => {
    const context = await httpContext(owner(c), paramId(c));
    const input = z
      .object({ redirectUrl: z.url() })
      .strict()
      .parse(await c.req.json());
    if (context.config.adapter === 'pi')
      return Response.json(await deps.pi.action(context, { action: 'auth-complete', args: input }));
    const url = new URL(input.redirectUrl);
    if (url.origin + url.pathname !== deps.oauth.provider(context).redirectUrl)
      return c.json({ error: '回调地址不匹配' }, 400);
    await deps.oauth.complete(context, {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
    });
    return c.json({ authorized: true });
  });
  app.get('/:id/oauth/callback', async (c) => {
    const context = await httpContext(owner(c), paramId(c));
    const input = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .parse(c.req.query());
    await deps.oauth.complete(context, input);
    return c.html(
      '<!doctype html><html lang="zh"><meta charset="utf-8"><title>授权完成</title><p>授权完成，请回到 MCP 平台刷新工具。</p></html>',
    );
  });
  app.delete('/:id/oauth', async (c) => {
    const context = await httpContext(owner(c), paramId(c));
    await deps.connections.close(owner(c), paramId(c));
    return Response.json(
      context.config.adapter === 'pi'
        ? await deps.pi.action(context, { action: 'logout' })
        : await deps.oauth.revoke(context),
    );
  });
  return app;
}
