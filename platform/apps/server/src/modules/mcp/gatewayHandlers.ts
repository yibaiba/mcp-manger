import {
  Server,
  type ServerContext,
  type Prompt,
  type Resource,
  type ResourceTemplateType,
} from '@modelcontextprotocol/server';
import type { Principal, ProfileService } from '../agent-profiles/profileService.js';
import type { InvocationService } from './invocationService.js';
import type { ContentService } from './contentService.js';
import type { ResourceSubscriptions } from './resourceSubscriptions.js';
import { legacyToolDefinition, parseTool } from '@platform/mcp';

export type GatewayHandlers = {
  profiles: ProfileService;
  invocations: InvocationService;
  content: ContentService;
  subscriptions: ResourceSubscriptions;
};
export function createGatewayServer(
  input: GatewayHandlers & { principal: Principal; channel: string; era: 'legacy' | 'modern' },
) {
  const { principal } = input;
  const access = () => ({ ...principal, principal });
  const server = new Server(
    { name: 'mcp-platform', version: '0.1.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
      },
    },
  );
  server.setRequestHandler('tools/list', async () => {
    await input.profiles.authenticate(principal.profileId, principal.token);
    const rows = await input.profiles.catalog(principal.ownerId, principal.profileId);
    return {
      tools: rows.map((row) => {
        const definition = { ...parseTool(row.definition), name: row.id };
        return input.era === 'legacy' ? legacyToolDefinition(definition) : definition;
      }),
    };
  });
  server.setRequestHandler('tools/call', (request, context) =>
    input.invocations.call({
      ...access(),
      toolId: request.params.name,
      arguments: request.params.arguments ?? {},
      signal: context.mcpReq.signal,
      onprogress: progressReporter(request.params._meta?.progressToken, context),
    }),
  );
  server.setRequestHandler('prompts/list', async () => ({
    prompts: (await input.content.catalog(access()))
      .filter((row) => row.kind === 'prompt')
      .map((row) => input.content.definition(row) as Prompt),
  }));
  server.setRequestHandler('resources/list', async () => ({
    resources: (await input.content.catalog(access()))
      .filter((row) => row.kind === 'resource')
      .map((row) => input.content.definition(row) as Resource),
  }));
  server.setRequestHandler('resources/templates/list', async () => ({
    resourceTemplates: (await input.content.catalog(access()))
      .filter((row) => row.kind === 'template')
      .map((row) => input.content.definition(row) as ResourceTemplateType),
  }));
  server.setRequestHandler('prompts/get', (request, context) =>
    input.content.prompt({
      ...access(),
      id: request.params.name,
      arguments: request.params.arguments,
      signal: context.mcpReq.signal,
      onprogress: progressReporter(request.params._meta?.progressToken, context),
    }),
  );
  server.setRequestHandler('resources/read', (request, context) =>
    input.content.read({
      ...access(),
      uri: request.params.uri,
      signal: context.mcpReq.signal,
      onprogress: progressReporter(request.params._meta?.progressToken, context),
    }),
  );
  server.setRequestHandler('resources/subscribe', async (request, context) => {
    await input.subscriptions.subscribe({
      access: access(),
      channel: input.channel,
      uri: request.params.uri,
      signal: context.mcpReq.signal,
    });
    return {};
  });
  server.setRequestHandler('resources/unsubscribe', async (request) => {
    await input.content.resolveResource(access(), request.params.uri);
    await input.subscriptions.release(input.channel, request.params.uri);
    return {};
  });
  return server;
}

function progressReporter(token: string | number | undefined, context: ServerContext) {
  return token === undefined
    ? undefined
    : (progress: { progress: number; total?: number; message?: string }) => {
        void context.mcpReq
          .notify({
            method: 'notifications/progress',
            params: { ...progress, progressToken: token },
          })
          .catch((error: unknown) =>
            console.error(
              'MCP progress delivery failed',
              error instanceof Error ? error.message : String(error),
            ),
          );
      };
}
