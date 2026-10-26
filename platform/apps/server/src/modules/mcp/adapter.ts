import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@platform/mcp';
import type { ConnectionInput } from '@platform/contracts';
import type {
  McpCatalog,
  McpOperation,
  McpNotification,
  McpRequestOptions,
  Progress,
} from '@platform/mcp';
export type ConnectionContext = { id: string; ownerId: string; config: ConnectionInput };
export interface ConnectionAdapter {
  status(): 'connected' | 'disconnected';
  discover(signal?: AbortSignal): Promise<Tool[]>;
  catalog(signal?: AbortSignal): Promise<McpCatalog>;
  request(operation: McpOperation, options?: McpRequestOptions): Promise<unknown>;
  watch(listener: (event: McpNotification) => void): () => void;
  call(input: {
    name: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
    onprogress?: (progress: Progress) => void;
  }): Promise<CallToolResult>;
  close(): Promise<void>;
}
export type AdapterFactory = (connection: ConnectionContext) => Promise<ConnectionAdapter>;
