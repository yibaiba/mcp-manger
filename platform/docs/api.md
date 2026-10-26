# API、权限与协议

## 三种授权

- 平台登录：Better Auth cookie，`/api/v1/auth/*`；管理写操作需匹配 `Origin`。
- 外部 Agent：`Authorization: Bearer <接入密钥或 OAuth access token>`；入口 `/mcp/:profileId`。每次列工具、调用和下载均重新检查当前授权及配置，撤销立即生效。
- 上游 MCP：官方 SDK OAuth，凭证绑定用户与连接，加密持久化。Pi 连接由独立 Pi 进程管理 OAuth，彼此不互用 token。

创建配置时明确选择工具、Skill 版本和可下载的产物 ID；未选择的工具不能调用。标识由连接 ID 和原始工具名派生，两个同名工具不会误路由。内部 Pi 直接调用同一 InvocationService，不通过网关 HTTP 回环；调用记录包括执行位置、连接、设备和状态，不记录完整参数或输出。

外部配置可在管理页生成（密钥仅显示一次）：

```json
{
  "mcpServers": {
    "platform": {
      "type": "http",
      "url": "https://平台域名/mcp/配置UUID",
      "headers": { "Authorization": "Bearer 生成的密钥" }
    }
  }
}
```

MCP SDK 使用 Streamable HTTP；初始化返回 `mcp-session-id`，后续请求携带会话 ID，DELETE 释放会话。工具调用返回原始 MCP content、isError 和 structuredContent；超时、取消或设备断线可能已执行，显示“结果未知”，不自动重放。工具服务自己可能有其协议重试行为，不能据此承诺跨任意供应商的 exactly-once。

## 管理接口 `/api/v1`

| 功能                    | 方法与路径                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 当前用户 / 可选模块状态 | `GET /me`                                                                                                                  |
| 设备                    | `GET /devices`、`POST /devices/pairings`、`POST /devices/pair`、`DELETE /devices/:id`                                      |
| 连接                    | `GET/POST /connections`、`POST /connections/:id/discover`、`POST /connections/:id/stop`                                    |
| 工具                    | `GET /tools`、`POST /tools/:id/call`（`{arguments:{...}}`）                                                                |
| Agent 配置              | `GET/POST /profiles`、`PUT /profiles/:id`（name/toolIds/skillVersionIds/artifactIds）                                      |
| 接入密钥                | `POST /profiles/:id/keys`、`GET /profiles/keys/all`、`DELETE /profiles/keys/:id`                                           |
| 上游授权                | `GET /connections/:id/oauth`、`POST .../start`、`GET .../callback`、`POST .../complete`（redirectUrl）、`DELETE .../oauth` |
| Agent OAuth             | `POST /oauth/register`、`GET /oauth/authorize`、`POST /oauth/consent`、`POST /oauth/token`、`POST /oauth/revoke`           |
| OAuth grants            | `GET /oauth/grants`、`DELETE /oauth/grants/:id`                                                                            |
| Skills                  | `GET/POST /skills`、`POST /skills/zip`、`POST /skills/git`、`GET /skills/:id/export`、`POST /skills/:id/install`           |
| 产物                    | `GET/POST /artifacts`、`GET /artifacts/:id/content`、`POST /artifacts/transfers`                                           |
| 记录                    | `GET /calls`、`POST /calls/:id/cancel`、`GET /transfers`、`GET /installations`                                             |
| Pi                      | `GET/POST /tasks`、`POST /tasks/:id/cancel`                                                                                |
| 导入                    | `POST /import/preview`、`POST /import/apply`（旧 mcpServers + 本地 deviceId；预览逐项返回 errors/warnings）                |

平台启动失败或数据库失败不会回退到假数据。输入错误返回 `VALIDATION`；业务错误返回可诊断的 `code/error`；非预期异常返回 500 并记录服务端错误。

导入支持 `stdio`、`sse`、`streamable-http`/`http`，映射 `url/command/args/env/headers/cwd`。预览返回每项的 `name/config/needsDevice/errors/warnings/authorization`；缺少设备、URL 无效或传输不支持等错误不会隐藏其他声明。`warnings` 只列未映射字段名和原因，不返回这些字段的原始值；包括 `options`、`perSessionClient`、权限和 OAuth 的旧策略需要逐项核对。应用前会重新验证全部声明，存在错误返回 `IMPORT_INVALID`，不会部分创建。界面允许选择本地命令执行设备，修改原文或设备后需要重新预览。

`PI_ENABLED` 和 `/me`、`/health` 的 `piEnabled` 仅表示内置 Agent 任务是否启用。所有 MCP 连接（包括 Pi 桥接）的授权、工具发现和调用均不受此开关或模型配置限制；模型配置仅在 `POST /tasks` 时检查。

## MCP 传输与执行位置

| 执行适配器 | Streamable HTTP | HTTP + SSE（旧版） | stdio                  |
| ---------- | --------------- | ------------------ | ---------------------- |
| 平台直连   | 支持 HTTP/HTTPS | 支持 HTTP/HTTPS    | 平台主机子进程         |
| Pi 桥接    | 支持 HTTP/HTTPS | 支持 HTTP/HTTPS    | 平台主机 Pi 子进程托管 |
| 设备连接器 | 支持 HTTP/HTTPS | 支持 HTTP/HTTPS    | 所选设备子进程         |

连接的 `transport` 分别为 `http`、`sse`、`stdio`。HTTP/SSE 提供 `url`；stdio 使用 `mode: "managed"`，提供 `command`、`args`，可选 `env`、`cwd`，无需 URL。平台及 Pi 的 stdio 命令在平台主机执行，Docker 部署时位于 server 容器，设备适配器在所选设备执行。可执行程序必须已安装在实际执行环境。停止连接会关闭 MCP 会话和子进程。

stdio 的进程凭证通过 `env` 配置；上游 HTTP OAuth 端点不适用于 stdio，调用时明确返回 `OAUTH_NOT_APPLICABLE`。外部 Agent 的接入授权和工具权限对三种传输一致生效。Pi 使用显式 `httpTransport`，按用户选择连接；协议不匹配会报错，不静默切换成另一协议。

标准传输是 stdio 和 Streamable HTTP；HTTP+SSE 用于兼容旧版本。WebSocket、TCP 或 Unix socket 属于自定义传输，不能仅凭名称视为通用 MCP 兼容协议。参考 [MCP 传输规范](https://modelcontextprotocol.io/specification/latest/basic/transports)。

## OAuth

发现端点 `/.well-known/oauth-authorization-server` 和 `/.well-known/oauth-protected-resource/mcp/:profileId`。Agent OAuth 支持 public client、PKCE S256、精确 redirect/resource 绑定、一次性授权码、access token 1 小时、refresh token 30 天及轮换；同一会话刷新后使用新 token。登录用户须显式同意指定配置，客户端注册不等于获得授权。

上游授权优先官方 SDK 的发现与动态注册；也可预注册 `oauth.clientId/clientSecret/scope`。CSRF state 十分钟、绑定连接、一次消费。撤销会终止本地连接并删除本地凭证；供应商侧已有授予需在供应商账户撤销，UI 明确提示。Cloudflare/Vercel 专项联调未以本地测试代替。

## 文件流转

`POST /artifacts` 发送原始二进制 body，附 `X-File-Name`（encodeURIComponent）、`X-Content-SHA256`（64 位小写 hex）。平台流式校验后才入库；不匹配删除临时文件并报错。

`POST /artifacts/transfers`：`{deviceId, direction:"send"|"receive", root, path, artifactId?}`。方向以设备为准：send 设备上传、receive 设备接收。平台签发十分钟单次令牌，仅绑定该传输和设备，URL 固定到平台源站。文件二进制不经过 WebSocket。

Agent 使用原接入密钥或 OAuth token 对 **`GET /mcp/:profileId/artifacts/:artifactId`** 发起授权下载。仅允许 `profile.artifactIds` 中的产物，响应流带 Content-Length 和 X-Content-SHA256。把产物 ID、文件名和哈希交给 Agent，Agent 下载后再次核对哈希；该接口不把整个文件塞进模型上下文。

## 设备通道 v1

`WSS /api/v1/devices/channel`，Authorization 设备令牌；浏览器 Origin 不允许用于设备通道。主动出站，无需设备监听公网端口。

```json
{
  "v": 1,
  "type": "request",
  "id": "请求UUID",
  "method": "call",
  "deadline": "ISO-8601 UTC",
  "params": { "connectionId": "连接UUID", "config": {}, "name": "原始工具名", "arguments": {} }
}
```

method：discover/call/close/skill.install/artifact.send/artifact.receive。设备响应 `{v:1,type:"result",id,result}` 或 `{v:1,type:"result",id,error:{code,message}}`；取消消息 `{v:1,type:"cancel",id}`。设备 hello 含 os/hostname/version；每 15 秒 heartbeat 报告服务状态；通道掉线三秒后重连，仅恢复连接，不重放请求。服务端心跳失联中断 pending 请求，明确标记结果未知。

协议源码：`packages/contracts/src/index.ts`、`connector/internal/agent/protocol.go`。自动化契约测试覆盖封包、真 WebSocket、两进程路由、取消和断线。
