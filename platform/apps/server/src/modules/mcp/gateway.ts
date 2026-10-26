import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ProfileService, Principal } from '../agent-profiles/profileService.js';
import type { InvocationService } from './invocationService.js';
export class Gateway {
  private readonly sessions = new Map<
    string,
    { principal: Principal; transport: WebStandardStreamableHTTPServerTransport; server: Server }
  >();
  constructor(
    private readonly profiles: ProfileService,
    private readonly invocations: InvocationService,
  ) {}
  async handle(request: Request, principal: Principal) {
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (
        !session ||
        session.principal.credentialId !== principal.credentialId ||
        session.principal.profileId !== principal.profileId
      )
        return Response.json({ error: '会话无效，请重新连接' }, { status: 404 });
      // Refresh rotation retains the grant ID; handlers must use its current token.
      session.principal.token = principal.token;
      return session.transport.handleRequest(request);
    }
    if (request.method !== 'POST') return new Response('MCP session required', { status: 400 });
    const body: unknown = await request.clone().json();
    if (!isInitializeRequest(body)) return new Response('Initialize required', { status: 400 });
    const server = new Server(
      { name: 'mcp-platform', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.profiles.authenticate(principal.profileId, principal.token);
      const rows = await this.profiles.catalog(principal.ownerId, principal.profileId);
      return { tools: rows.map((row) => ({ ...ToolSchema.parse(row.definition), name: row.id })) };
    });
    server.setRequestHandler(CallToolRequestSchema, (call, extra) =>
      this.invocations.call({
        ownerId: principal.ownerId,
        profileId: principal.profileId,
        principal,
        toolId: call.params.name,
        arguments: call.params.arguments ?? {},
        signal: extra.signal,
      }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        this.sessions.set(id, { principal, transport, server });
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  }
  async revoke(credentialId: string) {
    this.invocations.revoke({ credentialId });
    for (const [id, session] of this.sessions) {
      if (session.principal.credentialId === credentialId) {
        this.sessions.delete(id);
        await session.server.close();
      }
    }
  }
  async close() {
    await Promise.all([...this.sessions.values()].map((s) => s.server.close()));
    this.sessions.clear();
  }
}
