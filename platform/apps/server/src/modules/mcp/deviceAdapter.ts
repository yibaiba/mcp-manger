import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DeviceBroker } from '../devices/deviceBroker.js';
import type { ConnectionAdapter, ConnectionContext } from './adapter.js';
export function createDeviceAdapter(
  context: ConnectionContext,
  broker: DeviceBroker,
): ConnectionAdapter {
  const params = { connectionId: context.id, config: context.config };
  return {
    status: () => (broker.online(context.config.deviceId!) ? 'connected' : 'disconnected'),
    async discover(signal) {
      return ListToolsResultSchema.parse(
        await broker.request(context.config.deviceId!, { method: 'discover', params, signal }),
      ).tools;
    },
    async call(input) {
      return CallToolResultSchema.parse(
        await broker.request(context.config.deviceId!, {
          method: 'call',
          params: { ...params, name: input.name, arguments: input.arguments },
          signal: input.signal,
        }),
      );
    },
    async close() {
      if (broker.online(context.config.deviceId!))
        await broker.request(context.config.deviceId!, { method: 'close', params });
    },
  };
}
