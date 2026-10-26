import { z } from 'zod';
export const PROTOCOL_VERSION = 1;
export const CALL_TIMEOUT_MS = 60_000;
export const HEARTBEAT_MS = 15_000;
export const pairingLifetimeMs = 10 * 60_000;
export const idSchema = z.uuid();
export const httpUrl = z
  .url()
  .refine(
    (v) =>
      URL.canParse(v) &&
      ['http:', 'https:'].includes(new URL(v).protocol) &&
      !new URL(v).username &&
      !new URL(v).password &&
      !new URL(v).hash,
    '必须是 HTTP(S) 地址',
  );
export const connectionInput = z
  .object({
    name: z.string().trim().min(1),
    adapter: z.enum(['direct', 'device', 'pi']),
    deviceId: idSchema.optional(),
    transport: z.enum(['http', 'sse', 'stdio']),
    mode: z.enum(['existing', 'managed']),
    url: httpUrl.optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    headers: z.record(z.string(), z.string()).default({}),
    cwd: z.string().optional(),
    oauth: z
      .object({
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        scope: z.string().optional(),
      })
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.adapter === 'device' && !v.deviceId) fail('设备连接必须选择设备');
    if (v.adapter !== 'device' && v.deviceId) fail('平台执行的连接不能关联设备');
    if (v.adapter !== 'device' && v.mode === 'managed' && v.transport !== 'stdio')
      fail('HTTP/SSE 托管启动请选择设备连接器；平台支持托管 stdio 进程');
    if (v.transport !== 'stdio' && !v.url) fail('HTTP/SSE 必须填写 URL');
    if (v.mode === 'managed' && !v.command) fail('托管启动必须填写命令');
    if (v.transport === 'stdio' && v.mode !== 'managed') fail('stdio 必须托管启动进程');
    if (v.transport === 'stdio' && (v.url || v.oauth))
      fail('stdio 不使用 HTTP 地址或上游 OAuth；凭证请通过 env 配置');
  });
export type ConnectionInput = z.infer<typeof connectionInput>;
export type ImportPreview = {
  name: string;
  config: unknown;
  needsDevice: boolean;
  warnings: { field: string; message: string }[];
  errors: string[];
  authorization: string;
};
export const profileInput = z
  .object({
    name: z.string().trim().min(1),
    toolIds: z.array(z.string()).default([]),
    skillVersionIds: z.array(idSchema).default([]),
    artifactIds: z.array(idSchema).default([]),
  })
  .strict();
export const callInput = z
  .object({ arguments: z.record(z.string(), z.unknown()).default({}) })
  .strict();
export const deviceResponse = z.discriminatedUnion('type', [
  z
    .object({
      v: z.literal(1),
      type: z.literal('hello'),
      os: z.string(),
      version: z.string(),
      hostname: z.string(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal('heartbeat'),
      services: z.array(
        z.object({ id: idSchema, status: z.string(), error: z.string().optional() }),
      ),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal('result'),
      id: idSchema,
      result: z.unknown().optional(),
      error: z.object({ code: z.string(), message: z.string() }).optional(),
    })
    .strict(),
]);
export type DeviceResponse = z.infer<typeof deviceResponse>;
export type DeviceRequest = {
  v: 1;
  type: 'request';
  id: string;
  method: 'discover' | 'call' | 'close' | 'skill.install' | 'artifact.receive' | 'artifact.send';
  deadline: string;
  params: Record<string, unknown>;
};
export const skillPackage = z
  .object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    files: z.record(z.string(), z.string()),
    dependencies: z.array(z.string()).default([]),
  })
  .strict();
export type SkillPackage = z.infer<typeof skillPackage>;
