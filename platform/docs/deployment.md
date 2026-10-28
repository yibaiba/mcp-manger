# 部署、备份与恢复

## 单镜像、单端口部署

默认单实例，没有 Redis、消息队列或多副本路由。MCP 会话和在线设备请求由服务进程维护；重启会中断请求并记录结果未知，不自动重放。

1. 安装 Docker / Compose，复制 `cp .env.example .env`。设置随机 `POSTGRES_PASSWORD`、`BETTER_AUTH_SECRET`、规范 Base64 的 `ENCRYPTION_KEY` 和独立的 `DEVICE_AUTH_ENCRYPTION_KEY`；加密密钥各为 32 字节，不在仓库提交 `.env`。
2. 将 `PUBLIC_URL` 和 `WEB_ORIGIN` 都设为浏览器实际访问的地址。有 Nginx 时填同一个 HTTPS 域名；直接访问时均填 `http://服务器IP:4300`。无需配置 Apps 子域名、第二个端口、APPS_ORIGIN 或 APPS_PORT。
3. 首次临时启用 `ALLOW_REGISTRATION=true`，注册后关闭并重建 server 容器。

```sh
docker compose build
docker compose up -d db
docker compose run --rm server pnpm db:migrate
docker compose up -d
docker compose logs --tail=100 server
```

统一应用容器的 **4300** 端口提供网页、API、MCP、WebSocket 和 `/_apps/*` 沙箱资源。Compose 仅包含应用和 PostgreSQL，数据库不发布公网端口；用户数据在持久卷。`/health` 检查数据库。连接器在实际设备运行，不在服务器容器中启动桌面软件。

已有 Nginx 时，只需把同一个站点的所有路径转发至 4300，保留 Host 和 WebSocket Upgrade，关闭 SSE 响应缓冲；HTTPS 证书由自己的 Nginx 管理。不使用 Nginx 时可直接使用 HTTP 地址，本镜像不附带网关或自动申请证书。Nginx 配置参考 [WebSocket 代理](https://nginx.org/en/docs/http/websocket.html) 与 [proxy_buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。

Apps 的公开资源仍走同一域名、同一端口，浏览器中通过 `data:` 代理 iframe 获得独立的 opaque origin；工具 HTML 在内层受 `sandbox` 属性和响应 CSP 限制的 iframe 中运行。代理只接受指定父窗口的消息，宿主检查消息来源窗口及 opaque origin；不会给管理 API 开放 null-origin CORS。专用的 frame 创建端点只允许不携带凭证的 opaque 代理请求，生成一次性文档地址，继续按声明的 CSP 约束工具网络访问。

生产模式（`NODE_ENV=production`）由后端提供 `apps/web/dist`，缺少网页构建则启动报错。开发环境仍可使用 Vite 的 4301；Apps 资源经后端 4300 提供，不再另开监听端口。旧配置中的 APPS_ORIGIN、APPS_PORT、DOMAIN、APPS_DOMAIN 可删除。

本机完整容器验收为 `node scripts/check.mjs 600 node scripts/verify-compose.mjs`，需先运行 `docker build -t mcp-platform:latest .`，并空出回环端口 54330。脚本使用随机临时凭证、独立 Compose 项目与卷，验证全新 / 重复迁移、网页与资源、登录/API、Apps 一次性文档和 CSP、真实 Go WebSocket 连接 / 服务重启重连 / 重配 / 撤销，以及真实无模型 Pi 桥接；结束后清理本次资源。该检查不包含用户自己的 Nginx、公网 HTTPS 或浏览器交互，浏览器验收见 [Apps 浏览器验证](apps-browser.md)。

镜像把 Corepack 缓存放在 `/usr/local/share/corepack`，运行用户 node 可禁网执行打包时安装的 pnpm。构建使用 BuildKit，按锁文件和补丁先 `pnpm fetch`，再复制源码离线安装；缺包或网络失败会终止构建。实现参考 [pnpm Docker 构建](https://pnpm.io/docker) 和 [Docker 缓存分层](https://docs.docker.com/build/cache/optimize/)。

## Release 镜像

前后端使用同一个 `ghcr.io/yibaiba/mcp-manger-platform:<版本>` 镜像，Dockerfile 最终 target 为 `app`，不再分别构建 server / web 镜像。Release 工作流在 Ubuntu amd64 + Buildx / QEMU 上构建 linux/amd64、linux/arm64 两种架构，执行类型检查、网页服务单测（60 秒硬超时）和生产构建。

发布标签 `v0.3.0` 对应镜像标签 `0.3.0`；正式 Release 同时更新 `latest`，预发布不更新 `latest`。普通 push 不触发打包；手动入口只验证构建，不推镜像或上传 Release 附件。发布使用 GitHub Token 登录 GHCR，无需 Docker Hub 凭证。首次发布后检查 GHCR 包的访问权限；私有镜像的部署机器需要先登录 GHCR。

准备 `.env` 并加入 `PLATFORM_VERSION=0.3.0`，用镜像覆盖文件部署；迁移是显式步骤，流水线不访问生产数据库：

```sh
docker compose -f compose.yaml -f compose.images.yaml pull
docker compose -f compose.yaml -f compose.images.yaml up -d db
docker compose -f compose.yaml -f compose.images.yaml run --rm server pnpm db:migrate
docker compose -f compose.yaml -f compose.images.yaml up -d
```

派生仓库可通过 `PLATFORM_IMAGE_PREFIX=ghcr.io/<owner>/<repo>-platform` 调整镜像名。Release 必须指向包含工作流的提交，通过 GitHub 界面或 `gh release create` 发布；仅推 tag 不触发平台发布。参考 [Release 触发条件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)、[发布 GHCR 镜像](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images) 和 [多架构构建](https://docs.docker.com/build/ci/github-actions/multi-platform/)。

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
