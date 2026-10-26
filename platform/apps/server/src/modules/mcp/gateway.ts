import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createMcpHandler,
  isLegacyRequest,
  isInitializeRequest,
  WebStandardStreamableHTTPServerTransport,
  readRequestBody,
  type McpHttpHandler,
  type Server,
} from '@modelcontextprotocol/server';
import type { Principal } from '../agent-profiles/profileService.js';
import { createGatewayServer, type GatewayHandlers } from './gatewayHandlers.js';
import type { ConnectionService, ConnectionEvent } from './connectionService.js';
import { scopedUri } from './catalogEntries.js';
import { ResourceSubscriptions } from './resourceSubscriptions.js';
import { streamFinally } from './gatewayStream.js';
import { AppError } from '../../shared/errors.js';

type Session = {
  principal: Principal;
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  channel: string;
};
type Modern = { principal: Principal; handler: McpHttpHandler; channels: Set<string> };
const listenRequest = z.object({
  method: z.literal('subscriptions/listen'),
  params: z.object({
    notifications: z.object({ resourceSubscriptions: z.array(z.string()).optional() }),
  }),
});

export class Gateway {
  private readonly sessions = new Map<string, Session>();
  private readonly modern = new Map<string, Modern>();
  private readonly subscriptions: ResourceSubscriptions;
  private readonly handlers: GatewayHandlers;
  private readonly unwatch: () => void;
  private readonly unwatchClosing: () => void;
  constructor(
    private readonly deps: Omit<GatewayHandlers, 'subscriptions'> & {
      connections: ConnectionService;
    },
  ) {
    this.subscriptions = new ResourceSubscriptions(deps.content);
    this.handlers = { ...deps, subscriptions: this.subscriptions };
    this.unwatch = deps.connections.watch((event) => this.notify(event));
    this.unwatchClosing = deps.connections.watchClosing((id) => this.connectionClosing(id));
  }
  async handle(request: Request, principal: Principal) {
    if (await isLegacyRequest(request)) return this.legacy(request, principal);
    let entry = this.modern.get(principal.credentialId);
    if (!entry) {
      const handler = createMcpHandler(
        (context) =>
          createGatewayServer({
            ...this.handlers,
            principal: { ...principal, token: context.authInfo?.token ?? principal.token },
            channel: randomUUID(),
            era: context.era,
          }),
        { legacy: 'reject', onerror: (error) => console.error('MCP gateway', error.message) },
      );
      entry = { principal, handler, channels: new Set() };
      this.modern.set(principal.credentialId, entry);
    }
    entry.principal.token = principal.token;
    return this.modernRequest(entry, request, principal);
  }
  private async modernRequest(entry: Modern, request: Request, principal: Principal) {
    const authInfo = { token: principal.token, clientId: principal.credentialId, scopes: ['mcp'] };
    if (request.method !== 'POST') return entry.handler.fetch(request, { authInfo });
    const body = await readRequestBody(request.clone());
    if (body.tooLarge) return new Response('Request too large', { status: 413 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return entry.handler.fetch(request, { authInfo });
    }
    const listen = listenRequest.safeParse(parsed);
    if (!listen.success) return entry.handler.fetch(request, { authInfo, parsedBody: parsed });
    const channel = randomUUID();
    entry.channels.add(channel);
    const release = async () => {
      entry.channels.delete(channel);
      await this.subscriptions.release(channel);
    };
    try {
      for (const uri of listen.data.params.notifications.resourceSubscriptions ?? []) {
        await this.subscriptions.subscribe({
          access: { ...principal, principal },
          channel,
          uri,
          signal: request.signal,
          active: () => entry.channels.has(channel),
        });
      }
      const response = await entry.handler.fetch(request, { authInfo, parsedBody: parsed });
      if (!response.ok) {
        await release();
        return response;
      }
      return streamFinally(response, release);
    } catch (error) {
      await release();
      throw error;
    }
  }
  private async legacy(request: Request, principal: Principal) {
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (
        !session ||
        session.principal.credentialId !== principal.credentialId ||
        session.principal.profileId !== principal.profileId
      )
        return Response.json({ error: '会话无效，请重新连接' }, { status: 404 });
      session.principal.token = principal.token;
      return session.transport.handleRequest(request);
    }
    if (request.method !== 'POST') return new Response('MCP session required', { status: 400 });
    const body = await readRequestBody(request.clone());
    if (body.tooLarge) return new Response('Request too large', { status: 413 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        { status: 400 },
      );
    }
    if (!isInitializeRequest(parsed)) return new Response('Initialize required', { status: 400 });
    const channel = randomUUID();
    const server = createGatewayServer({ ...this.handlers, principal, channel, era: 'legacy' });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        this.sessions.set(id, { principal, transport, server, channel });
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
        void this.subscriptions
          .release(channel)
          .catch((error: unknown) => console.error('Resource subscription cleanup failed', error));
      },
    });
    await server.connect(transport);
    return transport.handleRequest(request, { parsedBody: parsed });
  }
  private async notify(event: ConnectionEvent) {
    for (const session of this.sessions.values()) {
      if (!(await this.visible(session.principal, event))) continue;
      const { method, params } = event.notification;
      if (method === 'notifications/resources/updated') {
        if (typeof params?.uri !== 'string') continue;
        const uri = scopedUri(event.connectionId, params.uri);
        if (this.subscriptions.has(session.channel, uri))
          await session.server.sendResourceUpdated({ uri });
      } else await session.server.notification({ method });
    }
    for (const entry of this.modern.values()) {
      if (!(await this.visible(entry.principal, event))) continue;
      const { method, params } = event.notification;
      if (method === 'notifications/tools/list_changed') entry.handler.notify.toolsChanged();
      if (method === 'notifications/prompts/list_changed') entry.handler.notify.promptsChanged();
      if (method === 'notifications/resources/list_changed')
        entry.handler.notify.resourcesChanged();
      if (method === 'notifications/resources/updated' && typeof params?.uri === 'string')
        entry.handler.notify.resourceUpdated(scopedUri(event.connectionId, params.uri));
    }
  }
  private async visible(principal: Principal, event: ConnectionEvent) {
    if (principal.ownerId !== event.ownerId) return false;
    try {
      await this.deps.profiles.authenticate(principal.profileId, principal.token);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'UNAUTHORIZED') throw error;
      await this.revoke(principal.credentialId);
      return false;
    }
    if (event.notification.method === 'notifications/resources/updated') {
      const uri = event.notification.params?.uri;
      if (typeof uri !== 'string') return false;
      try {
        await this.deps.content.resolveResource(
          { ...principal, principal },
          scopedUri(event.connectionId, uri),
        );
        return true;
      } catch (error) {
        if (error instanceof AppError && error.code === 'RESOURCE_FORBIDDEN') return false;
        throw error;
      }
    }
    return this.deps.content.eventVisible(principal, event.connectionId, event.notification.method);
  }
  async revoke(credentialId: string) {
    this.deps.invocations.revoke({ credentialId });
    await this.remove((principal) => principal.credentialId === credentialId);
  }
  private async connectionClosing(connectionId: string) {
    const affected = new Set<string>();
    for (const session of this.sessions.values()) {
      if (this.subscriptions.includesConnection(session.channel, connectionId))
        affected.add(session.principal.credentialId);
    }
    for (const entry of this.modern.values()) {
      if (
        [...entry.channels].some((channel) =>
          this.subscriptions.includesConnection(channel, connectionId),
        )
      )
        affected.add(entry.principal.credentialId);
    }
    await this.remove((principal) => affected.has(principal.credentialId));
  }
  async profileChanged(profileId: string) {
    this.deps.invocations.revoke({ profileId });
    await this.remove((principal) => principal.profileId === profileId);
  }
  private async remove(matches: (principal: Principal) => boolean) {
    for (const [id, session] of this.sessions) {
      if (!matches(session.principal)) continue;
      this.sessions.delete(id);
      await session.server.close();
      await this.subscriptions.release(session.channel);
    }
    for (const [id, entry] of this.modern) {
      if (!matches(entry.principal)) continue;
      this.modern.delete(id);
      await entry.handler.close();
      for (const channel of entry.channels) await this.subscriptions.release(channel);
    }
  }
  async close() {
    this.unwatch();
    this.unwatchClosing();
    await this.remove(() => true);
  }
}
