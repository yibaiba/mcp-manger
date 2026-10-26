import { resolve } from 'node:path';
import type { Database } from '@platform/db';
import type { Config } from './config.js';
import { Vault } from './shared/crypto.js';
import { DeviceBroker } from './modules/devices/deviceBroker.js';
import { DeviceService, reportDevice } from './modules/devices/deviceService.js';
import { ConnectionService } from './modules/mcp/connectionService.js';
import { createDirectAdapter } from './modules/mcp/directAdapter.js';
import { createDeviceAdapter } from './modules/mcp/deviceAdapter.js';
import { UpstreamOAuth } from './modules/authorizations/upstreamOAuth.js';
import { AgentOAuth } from './modules/authorizations/agentOAuth.js';
import { ProfileService } from './modules/agent-profiles/profileService.js';
import { InvocationService } from './modules/mcp/invocationService.js';
import { Gateway } from './modules/mcp/gateway.js';
import { ContentService } from './modules/mcp/contentService.js';
import { SkillService } from './modules/skills/skillService.js';
import { DiskFileStore } from './modules/artifacts/fileStore.js';
import { ArtifactService } from './modules/artifacts/artifactService.js';
import { PiService } from './modules/pi-runtime/piService.js';
export function createServices(db: Database, config: Config) {
  const vault = new Vault(config.ENCRYPTION_KEY);
  const broker = new DeviceBroker((id, message) => reportDevice(db, id, message));
  const devices = new DeviceService(db, broker);
  const upstreamOAuth = new UpstreamOAuth({ db, vault, publicUrl: config.PUBLIC_URL, fetch });
  const profiles = new ProfileService(db);
  const connections: ConnectionService = new ConnectionService({
    db,
    vault,
    devices,
    publicUrl: config.PUBLIC_URL,
    factory: async (context) => {
      if (context.config.adapter === 'device') return createDeviceAdapter(context, broker);
      if (context.config.adapter === 'pi') return pi.bridge(context);
      return createDirectAdapter(context, upstreamOAuth.provider(context), {
        logStderr: (message) => console.error('MCP stderr', context.id, message),
      });
    },
  });
  const invocations: InvocationService = new InvocationService({ db, profiles, connections });
  const content = new ContentService({ db, profiles, connections });
  const gateway = new Gateway({ profiles, invocations, content, connections });
  const skills = new SkillService({ db, broker, devices, profiles });
  const artifacts = new ArtifactService({
    db,
    files: new DiskFileStore(resolve(config.DATA_DIR, 'artifacts')),
    broker,
    devices,
    publicUrl: config.PUBLIC_URL,
  });
  const agentOAuth = new AgentOAuth({ db, profiles, publicUrl: config.PUBLIC_URL });
  const pi: PiService = new PiService({ db, config, profiles, invocations, skills, content });
  return {
    broker,
    devices,
    connections,
    upstreamOAuth,
    profiles,
    invocations,
    gateway,
    content,
    skills,
    artifacts,
    agentOAuth,
    pi,
  };
}
export type Services = ReturnType<typeof createServices>;
