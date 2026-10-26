# 部署、备份与恢复

## Docker Compose + HTTPS

默认单实例，没有 Redis、消息队列或多副本路由。MCP 会话和在线设备请求由服务进程维护；重启会中断请求并记录结果未知，不自动重放。

1. 云主机安装 Docker/Compose，DNS 指向主机，开放 80/443（Caddy 自动申请证书）。
2. `cp .env.example .env`；设置 `DOMAIN`、`PUBLIC_URL=https://你的域名`、`WEB_ORIGIN=https://你的域名`、随机 `POSTGRES_PASSWORD`（建议 32 字节 hex）、`BETTER_AUTH_SECRET`、32 字节 base64 `ENCRYPTION_KEY`。数据库连接由 Compose 注入。不要在仓库提交 `.env`。
3. 首次临时启用 `ALLOW_REGISTRATION=true`，注册后关闭并重建 server 容器。

```sh
docker compose build
docker compose up -d db
docker compose run --rm server pnpm db:migrate
docker compose up -d
docker compose logs --tail=100 server
```

`/health` 会检查数据库。PostgreSQL 不发布公网端口；Caddy 转发 `/api/*`、`/mcp/*`、`/.well-known/*` 和 WebSocket。数据库、产物、Pi 会话和证书分别存放在持久卷。设备连接器在实际设备运行，不在服务器容器中启动桌面软件。

Pi 已包含在默认镜像中；Pi MCP 桥接无需启用推理或配置模型。仅执行内置 Agent 任务时在 `.env` 设置 `PI_ENABLED=true` 并配置模型，执行 `docker compose up -d server` 更新容器配置，无需重新安装 Pi 或重建镜像。模型供应商密钥需通过自己的 Compose override 的 `environment` 或 secret manager 注入；默认 Compose 不把全部宿主机环境传入容器。Pi OAuth 还需 `PI_MCP_ADAPTER_OAUTH_FILE_KEY`，见 [Pi](pi.md)。

## 备份

```sh
pnpm backup /absolute/new-backup-directory
```

脚本暂停 server，生成 PostgreSQL 自定义格式备份、文件卷 tar、受限权限的 `.env` 副本，最后恢复服务。中途失败会以非零状态退出，不报告成功。备份期间设备掉线；执行中的工具结果可能未知，维护前应先等运行任务结束。数据量较大时可手工执行同样步骤并按容量调整命令超时（脚本每条命令 180 秒）。

`platform.env` 含数据库与加密密钥，必须私密保存；没有原 `ENCRYPTION_KEY` 不能解密 MCP/OAuth 凭证。Pi 凭证还依赖原 Pi 文件密钥。备份文件不要上传到公开仓库。

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
