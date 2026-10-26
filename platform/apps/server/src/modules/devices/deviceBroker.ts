import { randomUUID } from 'node:crypto';
import {
  deviceResponse,
  CALL_TIMEOUT_MS,
  HEARTBEAT_MS,
  type DeviceRequest,
  type DeviceResponse,
} from '@platform/contracts';
import type { WebSocket } from 'ws';
import { AppError } from '../../shared/errors.js';

type Pending = {
  deviceId: string;
  socket: WebSocket;
  finish: (value: unknown, error?: Error) => void;
};
export class DeviceBroker {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly report: (id: string, message: DeviceResponse) => Promise<void>) {}
  online(id: string) {
    return this.sockets.get(id)?.readyState === 1;
  }
  attach(id: string, socket: WebSocket) {
    this.disconnect(id);
    this.sockets.set(id, socket);
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('pong', () => {
      alive = true;
    });
    socket.on('message', (data) => {
      void this.receive(id, socket, data.toString()).catch(() =>
        socket.close(1008, 'Invalid device message'),
      );
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearInterval(heartbeat);
      if (this.sockets.get(id) === socket) this.sockets.delete(id);
      for (const request of this.pending.values()) {
        if (request.socket === socket)
          request.finish(
            undefined,
            new AppError(
              'RESULT_UNKNOWN',
              '设备连接中断；操作可能已执行，请检查设备后再决定是否重试',
              503,
            ),
          );
      }
    });
  }
  private async receive(id: string, socket: WebSocket, raw: string) {
    const message = deviceResponse.parse(JSON.parse(raw));
    if (message.type !== 'result') return this.report(id, message);
    const pending = this.pending.get(message.id);
    if (!pending || pending.socket !== socket) return;
    pending.finish(
      message.result,
      message.error ? new AppError(message.error.code, message.error.message, 502) : undefined,
    );
  }
  request(
    deviceId: string,
    input: {
      method: DeviceRequest['method'];
      params: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ) {
    const socket = this.sockets.get(deviceId);
    if (!socket || socket.readyState !== 1)
      return Promise.reject(new AppError('DEVICE_OFFLINE', '设备离线，无法执行', 503));
    if (input.signal?.aborted)
      return Promise.reject(new AppError('CANCELLED', '请求已取消；设备执行状态需确认', 409));
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const cancel = () => {
        socket.send(JSON.stringify({ v: 1, type: 'cancel', id }));
        finish(
          undefined,
          new AppError('RESULT_UNKNOWN', '已请求取消或达到截止时间；请确认设备执行结果', 409),
        );
      };
      const timer = setTimeout(cancel, CALL_TIMEOUT_MS);
      const finish = (value: unknown, error?: Error) => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', cancel);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      this.pending.set(id, { deviceId, socket, finish });
      input.signal?.addEventListener('abort', cancel, { once: true });
      const request: DeviceRequest = {
        v: 1,
        type: 'request',
        id,
        method: input.method,
        params: input.params,
        deadline: new Date(Date.now() + CALL_TIMEOUT_MS).toISOString(),
      };
      socket.send(JSON.stringify(request), (error) => {
        if (error)
          finish(undefined, new AppError('RESULT_UNKNOWN', '设备发送失败；执行结果未知', 503));
      });
    });
  }
  disconnect(id: string) {
    this.sockets.get(id)?.terminate();
    this.sockets.delete(id);
  }
  close() {
    for (const id of this.sockets.keys()) this.disconnect(id);
  }
}
