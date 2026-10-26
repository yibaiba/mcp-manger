import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionInput } from '@platform/contracts';
export type ConnectionContext = { id: string; ownerId: string; config: ConnectionInput };
export interface ConnectionAdapter {
  status(): 'connected' | 'disconnected';
  discover(signal?: AbortSignal): Promise<Tool[]>;
  call(input: {
    name: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<CallToolResult>;
  close(): Promise<void>;
}
export type AdapterFactory = (connection: ConnectionContext) => Promise<ConnectionAdapter>;
