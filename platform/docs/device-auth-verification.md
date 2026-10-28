# 设备 HMAC 认证实施与验收（2026-10-27）

基线 `e5b9c7c`。连接器升级至 0.3.0，与服务端一同部署；不兼容旧设备 Bearer 协议。此次升级基于既有随机设备凭证，不代表此前存在“仅凭设备 ID 登录”的已确认漏洞。

## 实现

- 同一 WSS 连接内进行 `auth.challenge` → `auth.response` → `auth.success`；认证通过后注册业务通道并返回成功，连接器随后发送 hello。随机 nonce 32 字节、30 秒有效、绑定连接、一次应答即消费；认证帧超过 4 KiB 在解析前拒绝。
- HMAC-SHA256 输入为约定的紧凑 JSON UTF-8 数组；使用标准库与恒定时间比较。源站取配置的 PUBLIC_URL / 已配对 server，不使用转发头。设备页通过 `/me` 的 `platformOrigin` 生成命令，开发前端端口与 API 端口不混用。
- 独立必填 DEVICE_AUTH_ENCRYPTION_KEY，格式错误或缺失时启动失败；Vault AES-GCM 的 AAD 绑定所有者、设备 ID、凭证版本。列表使用白名单，长期密钥仅兑换响应返回并设置 no-store。
- 每设备队列串行执行认证完成和注册、重配及撤销；凭证更新使用数据库事务。生成重配码即清除旧密钥、递增版本、替换未兑换码并断线。已撤销设备不可恢复。
- 迁移 0008 保留设备 ID、资源关联和同步基线，移除旧 tokenHash；没有新密钥的设备显示待重新配对。
- `connector re-pair` 原子替换凭证并移除旧 token，保留未知配置字段、目录设置及 server 的原始字符串，避免改变本机同步身份。保存失败明确要求重新生成重配码，不恢复旧密钥。
- 设备页有断线确认、待重配状态和一次性重配码；不会展示长期密钥。离线管理仍可使用。未改变 MCP 权限、固定凭证引用和一次性文件传输令牌。

## 已完成验证

| 验证                             | 结果                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查、ESLint、前后端生产构建 | 通过                                                                                                                                   |
| 完整后端回归                     | 六组 124 个用例全部通过，每个测试进程硬超时 60 秒                                                                                      |
| 最终认证与核心回归               | 19 个用例通过，其中设备认证 10 个，包含新增未应答 30 秒超时关闭                                                                        |
| Go test / vet                    | 通过，go test 使用 60 秒超时并另有进程硬超时                                                                                           |
| 六架构交叉构建                   | macOS / Linux / Windows × amd64 / arm64 全部通过，产物及 SHA256SUMS 在 connector/bin                                                   |
| 真实 Go + PostgreSQL             | 设备 MCP 调用、文件传输、断线结果未知且不重放通过                                                                                      |
| 浏览器                           | Chrome：重配确认与取消、立即断线、待重配、CLI 重配后恢复在线；MCP / Skills 绑定 ID 和同步基线保留；375px 布局与原本机编辑/恢复流程通过 |
| Docker / Caddy                   | 新库及重复迁移、管理认证、静态页、隔离源 HTTP 契约和真实无模型 Pi 桥接通过                                                             |
| 真实 Go + Caddy HTTPS/WSS        | HMAC 握手、代理重启后自动重连、重配立即失效、旧密钥重连被拒、新密钥恢复、撤销后重连被拒通过                                            |

Node / Go 共用 `packages/contracts/testdata/device-auth-vectors.json`，覆盖大小写、默认端口、IPv6 压缩、非默认端口和国际化域名。认证用例覆盖错误密钥、ID 冒用、错误版本、错误源站、过期挑战、重复应答、跨连接重放、非法帧、旧 Bearer / Origin 拒绝、认证前不注册及失败认证不踢掉已在线设备。

重配用例覆盖会话与 Origin、设备归属、单次使用、重复生成、过期、原设备恢复、并发串行性及撤销终态。Go 配置测试覆盖未知字段保留、原子替换失败、明确恢复提示及后续保存重试；密钥不进入列表和连接器日志。

复现命令（在 platform/）：

```sh
pnpm check-types
pnpm lint
pnpm build
pnpm test
node scripts/check.mjs 60 pnpm exec vitest run tests/deviceAuth.test.ts tests/core.test.ts
(cd connector && node ../scripts/check.mjs 60 go test -timeout 60s ./...)
(cd connector && node ../scripts/check.mjs 60 go vet ./...)
pnpm connector:build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check.mjs 60 node --import tsx scripts/verify-local-browser.mjs
node scripts/check.mjs 600 node scripts/verify-compose.mjs
```

当前 Compose 验收需预先构建最新 `mcp-platform:latest` 单应用镜像及本机 `connector/bin/connector`，空出回环端口 54330。脚本创建独立项目、随机凭证和卷，结束时清理本次资源；当前同端口部署步骤以 [部署说明](deployment.md) 为准。历史 HTTPS 验收使用临时 Caddy 内部 CA，Node 显式传入 CA，macOS Go 通过 `--ca-cert` 加入进程信任池，没有跳过 TLS 或修改系统钥匙串；该历史结果不代表当前公网 HTTPS 已完成验收。

## 运维与验证边界

本地开发库已应用 0008，已有设备需要重新配对。本地忽略文件 `.env` 已独立生成设备认证主密钥；部署环境须另行生成、保护和备份，不能复用开发密钥。服务端和连接器一起升级；回退须恢复升级前数据库、持久数据、密钥和匹配程序，不重新启用 Bearer。

公网 DNS / 证书签发、Windows / Linux 原生运行与系统服务尚未实测；六架构构建和本地 Compose 不代表这些项目已通过。生产备份恢复演练仍需部署环境验证。此前文档中的其他桌面客户端、供应商 OAuth 和模型任务边界继续有效。

共享秘密的 HMAC 不隔离已被攻破的服务端，也不缩小连接器现有的程序启动、文件管理和 MCP 调用权限。
