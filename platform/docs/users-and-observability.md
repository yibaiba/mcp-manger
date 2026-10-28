# 用户、登录与运行记录

## 账号与角色

迁移 `0009` 为现有账号增加 `role=member` 和 `enabled=true`，不创建默认管理员。先注册账号，再由有数据库访问权限的本机操作员显式提升：

```sh
pnpm user:role operator@example.org admin
```

CLI 仅修改指定账号角色，不输出密码、会话或凭证。可用 `member` 降级。管理员页面支持创建、编辑、启停账号和撤销登录会话；个人账号页面支持改密、撤销自己的会话和显式绑定登录身份。

停用先持久化拒绝访问、删除登录会话及待兑换 OAuth code、撤销 Agent key/OAuth grant，再取消调用、Pi 任务、MCP 会话及连接并断开设备通道。清理失败会返回错误，账号保持停用。重新启用不恢复被撤销的凭证。管理请求、Agent 认证和运行时权限检查均读取当前账号状态。

管理入口为 `/api/v1/admin/users`、`/api/v1/admin/users/:id` 和其 `/sessions` 子路径；个人会话位于 `/api/v1/me/sessions`。密码更新复用 Better Auth 的 `/api/v1/auth/change-password`。

`ALLOW_REGISTRATION=false` 同时关闭邮箱和 SSO 新用户注册，并在 Better Auth 用户创建入口再次校验；`requestSignUp` 不能绕过。已绑定账号的登录、显式身份关联及管理员创建账号不受关闭注册影响。

## Google、GitHub 和 OIDC

在部署环境配置 `AUTH_PROVIDERS` JSON。不存在的提供方不会显示登录入口；空字符串表示未配置，便于 Compose 传入可选环境变量；部分填写或无效 JSON 会阻止启动并报告配置错误。密钥只放在环境或秘密管理系统，不提交到文件库。

结构如下，`<secret>` 必须替换为部署端注入的值：

```json
{
  "google": { "clientId": "<client-id>", "clientSecret": "<secret>" },
  "github": { "clientId": "<client-id>", "clientSecret": "<secret>" },
  "oidc": {
    "name": "企业登录",
    "clientId": "<client-id>",
    "clientSecret": "<secret>",
    "issuer": "https://id.example.org",
    "discoveryUrl": "https://id.example.org/.well-known/openid-configuration"
  }
}
```

回调地址分别为 `PUBLIC_URL/api/v1/auth/callback/google`、`.../callback/github` 和 `.../oauth2/callback/oidc`。项目固定使用 Better Auth 1.6.19；其 generic OAuth 接口与最新在线文档的路由可能不同，以已安装版本为准。

身份唯一键为 provider＋subject。禁止按邮箱隐式合并，即使供应商声称邮箱已验证，也需要登录已有账号后显式绑定。新 SSO 用户始终为普通用户。OIDC 开启 PKCE，并通过配置 issuer 的 UserInfo 接口读取和校验 subject，不使用未经验证的 ID-token 解码结果作为身份。供应商需要提供 UserInfo endpoint、subject、email 和 name。

本地协议夹具已验证 OIDC 回调、PKCE 参数、重复登录、subject 绑定和邮箱冲突拒绝；Google、GitHub 和目标 OIDC 的真实联调尚未执行。

## 调用记录

旧 `/api/v1/calls` 数组接口保留。新界面使用 `/api/v1/activity/calls`，支持 `from`（含）、`before`（不含）、toolId、connectionId、deviceId、profileId、taskId、status、limit 和 cursor。时间必须包含时区。分页按完整 PostgreSQL 时间精度及 ID 排序；默认每页 50 条，返回 `items/nextCursor`。

`/stats` 返回当前筛选范围的状态计数与耗时，`/:id` 返回账号自己的调用元数据。请求参数、交互回答和工具结果不写入调用日志；失败日志保存固定错误类别，具体上游错误仅返回本次调用方。

`POST /cleanup/preview` 接受相同筛选条件，返回数量和绑定当前账号的加密预览 token。`POST /cleanup` 接受该 token，仅清理预览时已经结束的记录。运行中、等待回答和预览后结束的调用保留。

## 系统日志与指标

迁移 `0010` 添加系统日志和调用查询索引。结构化日志同时输出 stdout 并写 PostgreSQL。持久事件包括 HTTP 请求、平台启动/停止、保留期清理，以及连接/设备/Pi/订阅/权限/本地同步的后台失败。后台回调通过注入的日志服务记录固定错误代码；退出前等待待写日志，写入失败明确报告。第三方进程 stderr 仅记录出现错误输出的事件，不保存原始业务文本。

日志输入采用字段白名单，仅记录事件类别、级别、账号 ID、静态路由模板、HTTP 方法/状态、耗时及错误代码，不保存原始路径参数、查询串、请求/响应内容或错误堆栈。写库失败输出明确诊断并返回 `LOG_PERSISTENCE_FAILED`，不能据此判断业务未执行或自动重放。

管理员通过 `/api/v1/admin/logs` 查询、`/stream` 实时订阅；清理使用相同的 `/cleanup/preview` 和 `/cleanup` 两步接口。订阅在每次推送前重新检查当前管理员资格，撤销后报告错误并关闭。界面可手动重新订阅，不隐式重连。

`METRICS_ENABLED=true` 且配置独立的 `METRICS_TOKEN`（至少 32 字符）后启用同端口 `/metrics`。抓取使用 `Authorization: Bearer <metrics-token>`；管理 Cookie 或 Agent key 不能代替。当前指标是已保留调用计数/平均耗时、连接与设备状态的 gauge；清理历史会改变前两者，不将其声明为累计 counter。标签仅含 adapter/status，不含账号、连接 ID、凭证、业务参数或错误文本。

默认不自动删除日志。显式配置 `CALL_RETENTION_DAYS` 或 `LOG_RETENTION_DAYS` 后每小时执行一次对应清理；运行及等待调用不参与清理。服务退出时等待正在进行的清理结束。手动清理始终需要用户先预览具体范围。

## 验证状态

- 账号与 OIDC 本地协议测试：6 项通过。
- 分页精度、账号隔离、清理快照、日志字段、写入失败、指标认证和日志订阅撤权：6 项通过。
- Chrome 已验证账号管理、停用后的浏览器会话失效及个人账号页面。调用记录/系统日志页面也已通过 Chrome 验收：两次真实工具调用的元数据、精确清理范围及实时日志。
- 完整回归首次运行的核心组超过 60 秒，未视为通过；新增账号/日志测试已拆为独立测试组，保持每个进程 60 秒硬限制，新分组后的 8 组、157 项完整回归已全部通过。后续新增 Compose 配置边界测试单独验证。
- 共享连接的两种凭证模式、权限交集、调用/内容/Apps/Pi/Go 路径、撤销隔离及账号停用均有集成覆盖；独立第二阶段工作区复验共 169 项唯一用例通过。分阶段整理时遗漏的既有连接创建方法及提前引入的后续阶段测试断言已修正，相关 24 项重跑通过；类型检查、lint、应用镜像构建及全新单端口 Compose 迁移/设备/Apps/Pi 验收通过。日志：`.data/stage2-worktree-tests.log`、`.data/stage2-regressions-rerun.log`、`.data/stage2-compose.log`。

## 受控共享连接

连接页可按接收账号邮箱共享已发现的工具、Prompt 和 Resource。默认独立授权；接收者必须在“共享给我的连接”填写自己的地址、凭证、设备和真实目录，再连接或完成 OAuth。缺少绑定显示“待配置”，不读取所有者凭证。保存配置后仍显示待连接，真实发现成功才显示已连接。

所有者可以明确选择“允许使用我的凭证或设备服务”。调用者、资源所有者与凭证归属分别记录；接收者不能查看或修改来源配置、OAuth 或设备管理。实际使用范围为共享授权与接收者 Profile 的交集；临时权限也不能扩大共享范围。拥有者的工具 ID 保留，权限和审计使用该稳定 ID。

会话按接收者、共享授权及接入身份隔离；修改授权版本使旧目录快照失效，撤销立即取消该授权的调用、订阅和 Apps，不关闭所有者或其他接收者的会话。共享 Go 设备服务沿用来源设备已有 HMAC 通道，不复制设备秘密，也不附带文件同步和 Skill 安装权限。独立 OAuth 存储属于接收者；代理 OAuth 的刷新与所有者操作共用串行队列，Pi worker 使用明确的凭证目录与独立会话。

管理接口：`GET/PUT /api/v1/connections/:id/shares`，`DELETE .../shares/:shareId`，`GET /api/v1/shares`，`PUT /api/v1/shares/:id/configuration`。授权更新必须携带当前 `version`，冲突返回 409。来源连接的管理仍使用严格所有权校验，未获共享访问保持原有 404 行为。迁移 `0011` 新增共享授权及调用身份列，不重建现有对象或凭证。
