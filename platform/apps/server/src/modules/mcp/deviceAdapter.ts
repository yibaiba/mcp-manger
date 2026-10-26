import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DeviceBroker } from '../devices/deviceBroker.js';
import type { ConnectionAdapter, ConnectionContext } from './adapter.js';
import { parseCatalog } from '@platform/mcp';
export function createDeviceAdapter(
  context: ConnectionContext,
  broker: DeviceBroker,
): ConnectionAdapter {
  const params = { connectionId: context.id, config: context.config };
  return {
    status: () => (broker.online(context.config.deviceId!) ? 'connected' : 'disconnected'),
    watch: (listener) =>
      broker.watch({ deviceId: context.config.deviceId!, connectionId: context.id, listener }),
    catalog: async (signal) =>
      parseCatalog(
        await broker.request(context.config.deviceId!, { method: 'catalog', params, signal }),
      ),
    request: (operation, options) =>
      broker.request(context.config.deviceId!, {
        method: 'mcp.request',
        params: { ...params, operation },
        ...options,
      }),
    async discover(signal) {
      return (await this.catalog(signal)).tools;
    },
    async call(input) {
      return CallToolResultSchema.parse(
        await broker.request(context.config.deviceId!, {
          method: 'call',
          params: { ...params, name: input.name, arguments: input.arguments },
          signal: input.signal,
          onprogress: input.onprogress,
        }),
      );
    },
    async close() {
      if (broker.online(context.config.deviceId!))
        await broker.request(context.config.deviceId!, { method: 'close', params });
    },
  };
}
