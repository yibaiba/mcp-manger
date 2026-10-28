import { z } from 'zod';
import { fileURLToPath } from 'node:url';
export const platformRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const envSchema = z.object({
  DATABASE_URL: z.url(),
  PUBLIC_URL: z.url(),
  WEB_ORIGIN: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string(),
  DEVICE_AUTH_ENCRYPTION_KEY: z.string().refine((value) => {
    const key = Buffer.from(value, 'base64');
    return key.length === 32 && key.toString('base64') === value;
  }, 'DEVICE_AUTH_ENCRYPTION_KEY must be canonical base64 for 32 bytes'),
  APPS_ORIGIN: z.url().optional(),
  APPS_PORT: z.coerce.number().int().positive().default(4302),
  PORT: z.coerce.number().int().positive().default(4300),
  DATA_DIR: z.string().default('.data'),
  ALLOW_REGISTRATION: z.enum(['true', 'false']).default('false'),
  // Only gates built-in agent tasks; MCP bridging loads independently on demand.
  PI_ENABLED: z.enum(['true', 'false']).default('false'),
  PI_MODEL_PROVIDER: z.string().optional(),
  PI_MODEL_ID: z.string().optional(),
  PI_MCP_ADAPTER_OAUTH_FILE_KEY: z.string().optional(),
});
export type Config = z.infer<typeof envSchema>;
