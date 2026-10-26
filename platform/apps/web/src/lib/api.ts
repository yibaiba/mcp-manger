export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.body && typeof options.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options?.headers,
    },
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ?? value.error ?? value.message ?? `请求失败 (${response.status})`,
    );
  return value as T;
}
export const json = (value: unknown) => JSON.stringify(value);
export type Device = {
  id: string;
  name: string;
  online: boolean;
  revoked: boolean;
  os: string | null;
  hostname: string | null;
  version: string | null;
  lastSeen: string | null;
  services: { id: string; status: string; error?: string }[];
};
export type Connection = {
  id: string;
  name: string;
  adapter: string;
  transport: string;
  mode: string;
  deviceId: string | null;
  status: string;
  error: string | null;
  url?: string;
  protocolVersion?: string | null;
  capabilities?: Record<string, unknown>;
};
export type Tool = {
  id: string;
  name: string;
  connectionId: string;
  definition: {
    description?: string;
    inputSchema: unknown;
    outputSchema?: unknown;
    [key: string]: unknown;
  };
};
export type ContentEntry = {
  id: string;
  connectionId: string;
  kind: 'prompt' | 'resource' | 'template';
  name: string;
  locator: string;
  definition: {
    description?: string;
    arguments?: { name: string; description?: string; required?: boolean }[];
    [key: string]: unknown;
  };
};
export type Profile = {
  id: string;
  name: string;
  toolIds: string[];
  contentIds: string[];
  skillVersionIds: string[];
  artifactIds: string[];
};
export type Skill = {
  id: string;
  name: string;
  digest: string;
  source: string;
  revision: string | null;
  createdAt: string;
  dependencies: string[];
};
export type Artifact = {
  id: string;
  name: string;
  sha256: string;
  size: number;
  createdAt: string;
};
export type Call = {
  id: string;
  toolId: string;
  adapter: string;
  connectionId: string;
  deviceId: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};
