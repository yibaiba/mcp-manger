# API、权限与协议

## 三种授权

- 平台登录：Better Auth cookie，`/api/v1/auth/*`；管理写操作需匹配 `Origin`。
- 外部 Agent：`Authorization: Bearer <接入密钥或 OAuth access token>`；入口 `/mcp/:profileId`。每次列目录、调用、读取和下载均重新检查当前授权及配置，撤销立即生效。
- 上游 MCP：官方 SDK OAuth，凭证绑定用户与连接，加密持久化。Pi 连接由独立 Pi 进程管理 OAuth，彼此不互用 token。

创建配置时明确选择工具、Prompts/Resources/模板、Skill 版本和可下载的产物 ID；未选择的工具不能调用。标识由连接 ID 和原始工具名派生，两个同名工具不会误路由。内部 Pi 直接调用同一 InvocationService，不通过网关 HTTP 回环；调用记录包括执行位置、连接、设备和状态，不记录完整参数或输出。

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

外部入口使用官方 SDK 2.3.1 双栈处理 Streamable HTTP：现代 2026-07-28 请求使用每次请求的协议元数据，无需旧会话初始化；旧客户端初始化返回 `mcp-session-id`，后续携带会话 ID，DELETE 释放会话。两种入口使用相同配置授权。工具调用保留 MCP content、isError、structuredContent、annotations、outputSchema 和 `_meta`；超时、取消或设备断线可能已执行，显示“结果未知”，不自动重放。工具服务自己可能有其协议重试行为，不能据此承诺跨任意供应商的 exactly-once。

### 内容目录与通知

`GET /catalog` 返回当前用户可用条目，含 `id/connectionId/kind/name/locator/definition`；kind 为 `prompt/resource/template`。管理侧 `POST /catalog/prompts/:id/get` 接收 `{arguments:{参数名:"字符串"}}`；`POST /catalog/resources/read` 接收 `{uri:"mcp-platform://连接UUID/上游URI"}`。例如 `file:///shared.txt` 对外表示为 `mcp-platform://连接UUID/file:///shared.txt`。URI 保留原始内容，按连接隔离；Prompt 对外名称使用稳定条目 ID。返回的资源链接和嵌入资源一并使用该命名空间。

Agent 配置新增 `contentIds` 白名单；默认空列表，旧配置不会因此自动暴露新内容。资源模板授权覆盖匹配该模板的实际 URI，实际读取前后重新检查授权。目录分页全部读取，未广告对应能力的上游不发送该类请求。

tools/prompts/resources 的 `list_changed` 触发目录刷新后，按配置授权转发下游；`resources/updated` 仅发送给有权访问且订阅该 URI 的客户端。旧协议使用 `resources/subscribe`、`resources/unsubscribe`，现代协议使用 `subscriptions/listen` 的 `resourceSubscriptions`；平台引用计数避免一个客户端退订影响其他客户端。停止连接会关闭使用其资源订阅的下游入口，重新连接后需重新订阅；清理不会重新创建已停止的上游。配置变更和凭证撤销立即关闭关联入口，并取消运行中的工具或 Pi 任务。进度通知沿原请求的 progressToken 关联转发。

HTTP/stdio 上游使用 SDK 自动协商，SSE 固定旧协议；连接列表记录实际协议版本和上游 capabilities。stdio 自动协商可能由官方 SDK 启动一个短暂的独立探测子进程；探测不执行工具，但启动命令本身仍需适合重复启动。

Schema 使用官方 AJV 按 `$schema` 选择 draft-07、2019-09、2020-12；无效 Schema 在发现阶段明确失败，输入不合法不派发调用，输出不合法明确报告且不重放。合法布尔子 Schema 在旧客户端目录中等价转换为 `{}` / `{not:{}}`，数据库与现代客户端保留原定义；不修改 enum/default 等数据字段。本次未实现可选的 MCP Tasks、Apps UI 或交互式输入能力，不广告未支持的能力。

协议依据：[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)、[TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)。

## 管理接口 `/api/v1`

| 功能                    | 方法与路径                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 当前用户 / 可选模块状态 | `GET /me`                                                                                                                  |
| 设备                    | `GET /devices`、`POST /devices/pairings`、`POST /devices/pair`、`DELETE /devices/:id`                                      |
| 连接                    | `GET/POST /connections`、`POST /connections/:id/discover`、`POST /connections/:id/stop`                                    |
| 工具                    | `GET /tools`、`POST /tools/:id/call`（`{arguments:{...}}`）                                                                |
| 内容目录                | `GET /catalog`、`POST /catalog/prompts/:id/get`、`POST /catalog/resources/read`                                            |
| Agent 配置              | `GET/POST /profiles`、`PUT /profiles/:id`（name/toolIds/contentIds/skillVersionIds/artifactIds）                           |
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

method：discover/catalog/call/mcp.request/close/skill.install/artifact.send/artifact.receive。`catalog` 返回工具、Prompts、Resources、模板、协议版本和 capabilities；`mcp.request` 的 params.operation 为 `{method,params}`，支持 prompts/get、resources/read、resources/subscribe、resources/unsubscribe。设备响应 `{v:1,type:"result",id,result}` 或 `{v:1,type:"result",id,error:{code,message}}`；取消消息 `{v:1,type:"cancel",id}`。设备 hello 含 os/hostname/version；每 15 秒 heartbeat 报告服务状态；通道掉线三秒后重连，仅恢复连接，不重放请求。服务端心跳失联中断 pending 请求，明确标记结果未知。

协议源码：`packages/contracts/src/index.ts`、`connector/internal/agent/protocol.go`。自动化契约测试覆盖封包、真 WebSocket、两进程路由、取消和断线。

设备通知封包为 `{v:1,type:"notification",connectionId,method,params,requestId?}`，支持三类 list_changed、resources/updated 和 progress；进度的 requestId 必须关联同一 WebSocket 的 pending 请求。换代设备连接发来的旧消息不处理。设备断线后订阅随上游会话结束，客户端应在重连后重新订阅；不重放已派发的工具请求。
