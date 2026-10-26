# 验证记录

日期：2026-10-26。环境：macOS amd64、Node 24.17.0、pnpm 10.12.4、Go 1.26.4、本机 Docker PostgreSQL 17。所有实现位于独立 `platform/`；原 MCPHub 工作区已有改动保留，没有切换旧连接或迁移旧 OAuth。

## 已通过

| 项目         | 证据与范围                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript   | `pnpm check-types`：后端、共享包、内置 Pi、测试、React 类型检查                                                                                                                                                                                                            |
| 静态检查     | `pnpm lint`：ESLint，无警告                                                                                                                                                                                                                                                |
| 构建         | `pnpm build`：tsdown 后端与 Vite 生产前端                                                                                                                                                                                                                                  |
| 自动化验收   | `pnpm test`，**36/36**；核心 29 项与 Pi 7 项分别在独立 Vitest 进程运行，各有 60 秒硬超时；本轮完整分组约 28 秒 + 24 秒，最终核心复验约 32 秒；运行前重新构建本机 Go 连接器                                                                                                 |
| Go           | `go test -timeout 60s ./...`、`go vet ./...`                                                                                                                                                                                                                               |
| 三平台产物   | `pnpm connector:build`：darwin/linux/windows × amd64/arm64 六个二进制及 SHA256SUMS；交叉编译不等于实机通过                                                                                                                                                                 |
| 传输矩阵     | 平台直连、Pi 桥接、Go 设备连接器 × Streamable HTTP / 旧版 SSE / stdio 全组合真实发现与调用；平台 stdio 验证 env/cwd、外部 Agent 转发和停止后子进程退出；Go SSE 验证请求结束后会话保留、取消单次调用后继续调用；Go 单测验证初始化取消会释放 HTTP 请求                       |
| Pi 内置依赖  | 全新临时目录仅执行根目录 `pnpm install --frozen-lockfile`，随后 `pnpm test:pi` 通过；真实 Pi SDK + pi-mcp-adapter 发现/调用本地 SDK MCP，原始 structuredContent 保留，无模型、无额外安装步骤                                                                               |
| 真实远程 MCP | 浏览器新建 DeepWiki Streamable HTTP 连接，发现 3 个工具，实际调用 `read_wiki_structure` 读取 `modelcontextprotocol/typescript-sdk`，返回 content、structuredContent，`isError:false`；内置 Agent 任务关闭                                                                  |
| 组件使用     | 业务表单使用 shadcn Input/Textarea/Select/Checkbox/Field；卡片 Card、状态 Badge、新建连接 Dialog、记录 Table、折叠区域 Collapsible；业务页不再直接拼原生表单控件                                                                                                           |
| 浏览器操作   | 真实登录和表单保存；Select 方向键/Enter、设备字段联动；Checkbox 标签名称、空格与标签点击、隐藏输入值；Dialog Escape 后焦点返回触发按钮；390 × 844 与桌面布局检查；任务页显示 Pi 已内置，无单独安装命令；导入预览逐项错误/未映射字段、shadcn 设备选择、修改原文使旧预览失效 |
| Compose      | `docker compose config --quiet` 通过；没有输出或提交真实密钥                                                                                                                                                                                                               |

29 个集成用例和 7 个运行时/诊断单元用例覆盖：Better Auth、账号隔离、CSRF、稳定工具标识和同名路由、越权拒绝、权限变更/密钥撤销、一次性配对/设备撤销、Agent OAuth PKCE/resource/授权码复用/refresh 轮换及现有会话、加密上下文隔离、安全 Skill 路径、产物校验/授权下载、取消、旧配置导入全量预验证、两台连接器进程、stdio 托管进程、文件 A→平台→B、Skill 更新/回滚/修改冲突、断线无重放、上游 SDK OAuth 回调/刷新/重启持久化/撤销后迟到写入拒绝；`PI_ENABLED=false` 且无模型配置时 Pi 桥接的管理 API 发现/授权状态/调用、外部官方 MCP 客户端调用；仅内置 Agent 任务检查模型配置；旧版 SSE 在平台、Pi、Go 的真实调用及单次取消后的会话续用；平台直连和 Pi stdio 的环境变量/工作目录、进程退出和外部 Agent 调用；选错协议时返回失败，不静默切换。

两个设备是同机两个真实 Go 进程；OAuth 流程测试使用本地协议服务，均明确属于自动化测试环境。协议不匹配测试会输出预期的 Pi HTTP 连接失败日志（含诊断性 SSE 探测，未切换为成功连接）；断线测试会输出预期的断开日志，上游流关闭时 Hono 输出 `Error: aborted`；断言与退出码均通过，未隐藏这些诊断。

## MCPHub 参考迁移专项

本轮新增 13 项自动化用例：并发初始化合并、前代清理顺序、旧结果/旧初始化失败不能覆盖替换实例、关闭失败汇总、stderr 分块凭证脱敏/尾部与超长行提示、取消等待者清理；真实 SDK 验证停止期间发现、两次并发发现只取消一次；真实 Node 子进程验证启动失败 stderr 与进程终止后下一次显式调用重新连接；导入验证 cwd、未映射字段、不返回旧 OAuth 值、缺设备仍可预览、未知传输不猜测和禁止部分导入，并复验设备撤销后发现被拒绝。

首次将所有用例合并在同一 Vitest 进程运行时，触发了 60 秒硬超时，未记为通过。随后按计划把 Pi 验证与核心测试分组，每组仍保留 60 秒硬超时；默认 `pnpm test` 顺序执行所有分组，任一组失败则整体失败，不重试失败用例。最终核心复验、Pi 验证、类型检查、静态检查和构建均通过。

参考来源、已落地与待迁移范围见 [MCPHub 参考与迁移记录](mcphub-reference.md)。本轮没有移植 Prompts/Resources、listChanged、SDK v2 双栈、完整进程树管理或 Schema 容错策略，也没有重跑原 MCPHub 测试。

## 未通过或未执行的实机验收

| 项目                   | 当前状态 / 所需条件                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker 镜像端到端      | 已尝试构建，拉取 `node:24-bookworm-slim` 基础层在 300 秒硬超时内未完成。镜像构建、容器启动未判定通过；网络恢复后重新运行 `docker compose build`、迁移与启动 |
| 公网 HTTPS             | 未配置云域名；Caddy 证书签发、WSS 跨公网未实测                                                                                                              |
| Windows + 另一台设备   | 需要实际 Windows 和另一台设备；包括重启自启动、撤销、桌面程序和权限环境                                                                                     |
| Cloudflare 直连 OAuth  | 需要实际账号、回调域名及权限；本地 SDK OAuth 测试不能替代                                                                                                   |
| Pi → Vercel OAuth      | 需要实际 Vercel 账号和回调；与平台直连分开验收                                                                                                              |
| 内置 Agent 推理        | 没有模型供应商、模型 ID 或凭证，未执行真实模型任务                                                                                                          |
| Claude Code Skill 加载 | 已验证真实文件分发，未启动 Claude Code 证明实际加载和使用 MCP；安装返回 loadedVerified:false                                                                |
| Pi Skill 使用          | 已实现 Pi loader 和版本文件注入；没有真实模型证明 Skill 行为及辅助资源使用                                                                                  |
| 实际跨设备文件         | 同机两进程已校验 SHA-256；两台物理设备的生成、接收处理、Agent 下载还需实机验收                                                                              |
| 备份恢复演练           | 已提供备份脚本和空部署恢复步骤；容器构建未完成，未对生产卷执行恢复                                                                                          |

首次发布前，应按上表完成对应实机验证。平台 SQL 密钥、Pi 文件密钥和数据库/文件备份必须一起纳入恢复演练。
