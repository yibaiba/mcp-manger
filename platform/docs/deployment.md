# 部署、备份与恢复

## Docker Compose + HTTPS

默认单实例，没有 Redis、消息队列或多副本路由。MCP 会话和在线设备请求由服务进程维护；重启会中断请求并记录结果未知，不自动重放。

1. 云主机安装 Docker/Compose，DNS 指向主机，开放 80/443（Caddy 自动申请证书）。
2. `cp .env.example .env`；设置 `DOMAIN`、`PUBLIC_URL=https://你的域名`、`WEB_ORIGIN=https://你的域名`、随机 `POSTGRES_PASSWORD`（建议 32 字节 hex）、`BETTER_AUTH_SECRET`、32 字节规范 Base64 `ENCRYPTION_KEY` 和另行独立生成的 `DEVICE_AUTH_ENCRYPTION_KEY`。数据库连接由 Compose 注入。将示例的本地 `APPS_ORIGIN` 改为 `https://apps.你的域名`，并设置 `APPS_DOMAIN=apps.你的域名`，为其配置 DNS；不要把开发默认 localhost 地址留在生产配置中。不要在仓库提交 `.env`。
3. 首次临时启用 `ALLOW_REGISTRATION=true`，注册后关闭并重建 server 容器。

```sh
docker compose build
docker compose up -d db
docker compose run --rm server pnpm db:migrate
docker compose up -d
docker compose logs --tail=100 server
```

`/health` 会检查数据库。PostgreSQL 不发布公网端口；Caddy 转发 `/api/*`、`/mcp/*`、`/.well-known/*` 和 WebSocket。数据库、产物、Pi 会话和证书分别存放在持久卷。设备连接器在实际设备运行，不在服务器容器中启动桌面软件。

Apps 使用单独源站，Caddy 将 APPS_DOMAIN 代理至 server:4302，仅暴露 Sandbox Proxy 和一次性 iframe 文档，不暴露管理 API。APPS_ORIGIN 必须与 PUBLIC_URL/WEB_ORIGIN 不同源；自定义域名时同步修改三项配置与 DNS。开发 `pnpm dev` 自动启动 4302，不需要单独启动命令。实际公网域名、证书、iframe/CSP 仍需部署验收。

镜像把 Corepack 缓存放在 `/usr/local/share/corepack`，运行用户 node 可以直接使用构建时安装的 pnpm，无需启动时再次联网下载。修改镜像后，可在本机运行 `node scripts/check.mjs 600 node scripts/verify-compose.mjs`：需要先构建出默认的 mcp-platform-server/web 镜像，并空出 54330/54332。验收使用独立项目名、随机临时凭证、新建卷和仅回环地址的 HTTPS 端口（显式信任本次 Caddy 内部 CA）及隔离源 HTTP 端口，检查非 root 用户禁网执行 pnpm、新库及重复迁移、Caddy 静态页、健康/登录 API、隔离源 HTTP 契约、真实无模型 Pi 桥接，以及真实 Go 连接器的 HMAC WSS 握手、Caddy 重启后的自动重连、重配和撤销；结束时只清理本次项目和卷。该检查需要支持 `!override` 的 Compose，不验证公网证书签发。

构建使用 BuildKit：先按锁文件、workspace 配置与补丁执行 `pnpm fetch`，再复制源码并离线安装。下载目录使用独立缓存挂载；源码或文档变化不会使下载层失效，中断后的重试也能复用已下载的包。Git 与 CA 系统包位于独立基础层，不随应用源码重新安装。首次下载仍需网络，缺包或下载失败会直接终止构建。实现参考 [pnpm Docker 构建](https://pnpm.io/docker) 与 [Docker 缓存分层](https://docs.docker.com/build/cache/optimize/)。

## Release 镜像

主程序已有 `Dockerfile` 的 `server` / `web` 两个 target。发布 GitHub Release 后，`.github/workflows/connector-installers.yml` 使用 Ubuntu amd64 + Buildx / QEMU 构建并发布两种架构（linux/amd64、linux/arm64），平台构建上下文为 `platform/`，与外层 MCPHub 镜像分开：

- `ghcr.io/yibaiba/mcp-manger-platform-server:<版本>`
- `ghcr.io/yibaiba/mcp-manger-platform-web:<版本>`

发布标签 `v0.3.0` 对应镜像标签 `0.3.0`；正式 Release 同时更新 `latest`，预发布不更新 `latest`。普通 push 不触发发布。Actions 手动执行只做构建验证，不推镜像或上传 Release 附件。镜像构建内执行类型检查与生产构建；使用 GitHub Token 登录 GHCR，无需配置 Docker Hub 凭证。首次发布后检查 GHCR 包的访问权限；私有镜像的部署机器需要先登录 GHCR。

按前文准备 `.env`，加入 `PLATFORM_VERSION=0.3.0`，使用镜像覆盖文件部署；该覆盖会移除本地 build 配置。迁移仍是显式步骤，不在发布流水线中访问生产数据库：

```sh
docker compose -f compose.yaml -f compose.images.yaml pull
docker compose -f compose.yaml -f compose.images.yaml up -d db
docker compose -f compose.yaml -f compose.images.yaml run --rm server pnpm db:migrate
docker compose -f compose.yaml -f compose.images.yaml up -d
```

派生仓库可用 `PLATFORM_IMAGE_PREFIX=ghcr.io/<owner>/<repo>-platform` 调整镜像前缀。Release 必须指向包含该工作流的提交，通过 GitHub 发布界面或 `gh release create` 发布；仅推送 tag 不触发本平台发布。GitHub 文档说明 [Release 触发条件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release) 和 [向 GHCR 发布镜像](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)；多架构构建使用 [Docker 官方 Buildx / QEMU 流程](https://docs.docker.com/build/ci/github-actions/multi-platform/)。

## 升级与回退

应用迁移前先停止服务并备份数据库、整个 DATA_DIR、SQL 与 Pi 加密密钥。0003/0004 增加授权绑定、目录快照和加密交互状态；0005/0006 增加工作空间修订、任务事件、权限申请、临时授权、身份指纹与交接。0007 增加本机来源、同步绑定和持久操作；新管理入口需要连接器 0.2.0。旧 Profile 省略新增字段时保留已有值，不迁移 MCPHub token。0008 移除设备 tokenHash，增加加密密钥及版本、重配目标关联；保留原设备和全部资源关联，但旧设备必须重新配对。连接器和服务端必须同时升级到设备协议 0.3.0，不提供旧 Bearer 兼容入口。Windows stdio host 与连接器必须使用相同版本。

运行中的工具、交互和 App 不支持跨重启恢复；升级后明确中断，禁止通过重新派发恢复。任务快照与输出检查点可查看，任务临时授权随中断任务失效；外部凭证临时授权保留至原截止时间。回退旧程序时恢复升级前数据库、持久目录、原加密密钥和匹配版本的连接器；不通过重新启用 Bearer 回退认证，不假设旧程序能读取新授权数据。本地已完成升级前备份、新库迁移、旧库备份恢复后升级及重复迁移，详情见 [工作空间验收](workspace-verification.md)；生产文件卷的恢复仍需部署环境验收。

Pi 已包含在默认镜像中；Pi MCP 桥接无需启用推理或配置模型。仅执行内置 Agent 任务时在 `.env` 设置 `PI_ENABLED=true` 并配置模型，执行 `docker compose up -d server` 更新容器配置，无需重新安装 Pi 或重建镜像。模型供应商密钥需通过自己的 Compose override 的 `environment` 或 secret manager 注入；默认 Compose 不把全部宿主机环境传入容器。Pi OAuth 还需 `PI_MCP_ADAPTER_OAUTH_FILE_KEY`，见 [Pi](pi.md)。

## 备份

```sh
pnpm backup /absolute/new-backup-directory
```

脚本暂停 server，生成 PostgreSQL 自定义格式备份、文件卷 tar、受限权限的 `.env` 副本，最后恢复服务。中途失败会以非零状态退出，不报告成功。备份期间设备掉线；执行中的工具结果可能未知，维护前应先等运行任务结束。数据量较大时可手工执行同样步骤并按容量调整命令超时（脚本每条命令 180 秒）。

`platform.env` 含数据库与加密密钥，必须私密保存；没有原 `ENCRYPTION_KEY` 不能解密 MCP/OAuth 凭证。设备密钥依赖原 `DEVICE_AUTH_ENCRYPTION_KEY`；独立保护并另行备份该主密钥，遗失后无法认证现有设备，须逐台重配。Pi 凭证还依赖原 Pi 文件密钥。备份文件不要上传到公开仓库。

## 恢复到新的空部署

先保留旧部署，使用新的 Compose 项目名或新主机；下面命令只针对空库与空文件卷。复制备份 `platform.env` 为新目录 `.env`，调整域名后使用相同密钥，完成镜像构建。

```sh
docker compose up -d db
docker compose exec -T db pg_restore -U platform -d platform --exit-on-error < /backup/database.dump
docker compose run --rm --no-deps -T server tar -C /app/.data -xf - < /backup/files.tar
docker compose run --rm server pnpm db:migrate
docker compose up -d
```

恢复后验证登录、连接授权、产物哈希、设备重新上线和配置权限。域名变化需更新设备 `server` 和上游 OAuth 回调注册，重新签发包含旧 resource URL 的 Agent OAuth 授权。恢复演练和公网站点证书仍须在部署环境验收，不能把配置检查当作已部署。

## 设备本机数据备份

平台备份含 0007 的脱敏副本与同步基线，不含设备原始固定凭证。停止连接器后另行备份其 `~/.mcplatform/local`（或配置的数据目录）、来源配置与 Skill 文件，保留原权限、配对配置及目录位置。该目录的 `manifest.json`、`backups/` 和 Skill 替换目录可能含原始凭证，按本机秘密保管。恢复后先核对操作记录，再连接平台处理差异；更换平台设备使用独立目录重新选择。见 [详细恢复步骤](local-management.md#备份与恢复)。

设备认证主密钥缺失或不是 32 字节规范 Base64 时启动失败，不复用其他密钥。按 [密钥管理指南](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html) 限制密钥和备份访问。普通配置导出不包含设备密钥；完整数据库灾备含加密后的设备凭证，环境灾备含主密钥，两者都需私密保存。
