import { and, eq, inArray, gt, isNull, or } from 'drizzle-orm';
import {
  profiles,
  artifacts,
  tools,
  accessKeys,
  oauthGrants,
  skillVersions,
  type Database,
} from '@platform/db';
import { profileInput } from '@platform/contracts';
import { digest, secretToken } from '../../shared/crypto.js';
import { AppError, requireValue } from '../../shared/errors.js';
export type Principal = { ownerId: string; profileId: string; credentialId: string; token: string };
export class ProfileService {
  constructor(private readonly db: Database) {}
  async owned(ownerId: string, id: string) {
    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.id, id), eq(profiles.ownerId, ownerId)));
    return requireValue(profile);
  }
  async save(ownerId: string, input: unknown, id?: string) {
    const value = profileInput.parse(input);
    const toolIds = [...new Set(value.toolIds)];
    const versionIds = [...new Set(value.skillVersionIds)];
    const validTools = toolIds.length
      ? await this.db
          .select()
          .from(tools)
          .where(and(eq(tools.ownerId, ownerId), inArray(tools.id, toolIds)))
      : [];
    const versions = versionIds.length
      ? await this.db
          .select()
          .from(skillVersions)
          .where(and(eq(skillVersions.ownerId, ownerId), inArray(skillVersions.id, versionIds)))
      : [];
    const artifactIds = [...new Set(value.artifactIds)];
    const grantedFiles = artifactIds.length
      ? await this.db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.ownerId, ownerId), inArray(artifacts.id, artifactIds)))
      : [];
    if (grantedFiles.length !== artifactIds.length)
      throw new AppError('INVALID_GRANTS', '选择的产物不属于当前用户');
    if (validTools.length !== toolIds.length || versions.length !== versionIds.length)
      throw new AppError('INVALID_GRANTS', '选择的工具或 Skill 版本不属于当前用户');
    if (versions.some((v) => v.dependencies.some((t) => !toolIds.includes(t))))
      throw new AppError('SKILL_DEPENDENCY', 'Skill 依赖的 MCP 工具尚未授权');
    if (new Set(versions.map((v) => v.name)).size !== versions.length)
      throw new AppError('SKILL_DUPLICATE', '每个 Skill 只能选择一个版本');
    if (id) {
      await this.owned(ownerId, id);
      const [profile] = await this.db
        .update(profiles)
        .set({ ...value, toolIds, skillVersionIds: versionIds })
        .where(eq(profiles.id, id))
        .returning();
      return profile;
    }
    const [profile] = await this.db
      .insert(profiles)
      .values({ ...value, ownerId, toolIds, skillVersionIds: versionIds })
      .returning();
    return profile;
  }
  list(ownerId: string) {
    return this.db.select().from(profiles).where(eq(profiles.ownerId, ownerId));
  }
  async issue(ownerId: string, id: string) {
    await this.owned(ownerId, id);
    const token = secretToken();
    const [key] = await this.db
      .insert(accessKeys)
      .values({ ownerId, profileId: id, name: 'Agent key', hash: digest(token) })
      .returning({ id: accessKeys.id });
    return { id: requireValue(key).id, token };
  }
  keys(ownerId: string) {
    return this.db
      .select({
        id: accessKeys.id,
        profileId: accessKeys.profileId,
        revoked: accessKeys.revoked,
        createdAt: accessKeys.createdAt,
      })
      .from(accessKeys)
      .where(eq(accessKeys.ownerId, ownerId));
  }
  async revoke(ownerId: string, id: string) {
    const rows = await this.db
      .update(accessKeys)
      .set({ revoked: true })
      .where(and(eq(accessKeys.id, id), eq(accessKeys.ownerId, ownerId)))
      .returning();
    requireValue(rows[0]);
  }
  async authenticate(profileId: string, token: string): Promise<Principal> {
    const hash = digest(token);
    const [key] = await this.db
      .select()
      .from(accessKeys)
      .where(
        and(
          eq(accessKeys.hash, hash),
          eq(accessKeys.profileId, profileId),
          eq(accessKeys.revoked, false),
          or(isNull(accessKeys.expiresAt), gt(accessKeys.expiresAt, new Date())),
        ),
      );
    if (key) return { ownerId: key.ownerId, profileId, credentialId: key.id, token };
    const [grant] = await this.db
      .select()
      .from(oauthGrants)
      .where(
        and(
          eq(oauthGrants.accessHash, hash),
          eq(oauthGrants.profileId, profileId),
          eq(oauthGrants.revoked, false),
          gt(oauthGrants.expiresAt, new Date()),
        ),
      );
    if (grant) return { ownerId: grant.ownerId, profileId, credentialId: grant.id, token };
    throw new AppError('UNAUTHORIZED', 'Agent 凭证无效、已过期或已撤销', 401);
  }
  async catalog(ownerId: string, profileId?: string) {
    const rows = await this.db
      .select()
      .from(tools)
      .where(and(eq(tools.ownerId, ownerId), eq(tools.available, true)));
    if (!profileId) return rows;
    const profile = await this.owned(ownerId, profileId);
    return rows.filter((tool) => profile.toolIds.includes(tool.id));
  }
}
