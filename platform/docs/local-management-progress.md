# 本地管理实施与验收记录

实施范围为独立 `platform/`，外层 MCPHub 的既有未提交改动保留。代码按本地核心、客户端适配、平台同步与凭证引用、共用界面和交付验证划分模块。

## 已实现

- `connector manage` 离线入口；`connect/run` 同时提供本机页。loopback 随机端口、一次性链接、本机会话、Origin / Host / CSRF 校验；静态前端随六架构 Go 二进制分发，目标机器无需 Node.js。
- Cursor、Claude Code、Codex、Pi 用户与显式项目来源；JSON/JSONC/TOML 局部写入、注释和未知字段保留、真实路径去重、损坏与未知语义诊断。系统与显式供应商来源只读。
- 所选资源的摘要、稳定 ID、设备目标关联、原子清单、操作日志、写前备份、准备阶段恢复及单目录写锁。原文件变化时拒绝覆盖；整份配置删除后可只恢复选定条目。
- 平台持久绑定、共同基线、单侧自动同步、双方冲突、确认删除、解除同步。按设备串行并使用 PostgreSQL advisory lock；副本修改与幂等结果同事务提交，待处理修改在重连后核对恢复。
- MCP 固定字符串保留本机引用，在实际发现/调用时解析；独立身份缺绑定时报错。子进程分块 stderr、尾部与执行错误脱敏。配置变化取消旧会话，不重放业务调用。
- Skill 内容哈希不可变版本、文件树 / 文本 / 二进制导入、历史内容载入编辑器与本机恢复；保留 Agent 原固定版本授权。
- 本机页和平台设备页共用 MCP、Skills、记录、搜索与差异组件；区分配置发现、程序存在、连接成功、同步、Agent 授权与客户端待重载。平台浏览器不直连目标 localhost。

## 自动化与 macOS 验证

运行命令与最终结果在下表记录；每个后端测试进程硬超时 60 秒。数量以当前仓库实际运行结果为准，不把计划中的历史测试计数视为断言。

| 检查                                       | 结果                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript 类型检查、ESLint、生产构建      | 通过                                                                                                                                       |
| Go `test -timeout 60s ./...` / `vet ./...` | 通过，22 个顶层测试，含子用例共 31 项                                                                                                      |
| 本地管理集成                               | 11 项通过，使用真实 Go 连接器、PostgreSQL 和真实 MCP 协议服务                                                                              |
| 默认完整后端回归                           | 115 项通过，分六个进程执行，每个进程硬超时 60 秒                                                                                           |
| 六架构连接器交叉构建                       | macOS / Linux / Windows × amd64 / arm64 通过，含本机前端与 SHA256SUMS                                                                      |
| Chrome 本机与平台入口                      | 实际离线 MCP / Skill 编辑、持久选择后配对、平台回写、冲突选择、历史版本保存和恢复副本通过；桌面和 375px 无横向溢出，键盘可操作；无页面异常 |
| 离线页面依赖                               | 浏览器验收只允许 loopback 请求，所有资源由二进制提供，不需要 CDN                                                                           |
| 已安装 Codex / Claude Code                 | 隔离 HOME 下，真实客户端读取连接器修改后的 TOML / JSON 配置通过；不调用模型，未声称完成交互式 Skill 使用                                   |
| Docker / Compose                           | 通过：最新镜像、新库与重复迁移、本地管理 API、静态页和鉴权、Sandbox 契约、真实无模型 Pi 桥接                                               |

11 项管理集成覆盖设备归属、无业务派发扫描、真实目录发现、凭证引用与不持久化明文、幂等提交、保留注释回写、双方冲突、凭证修改失效、Skill 固定授权、离线平台修改重连、不回环、中断修改恢复、解除同步和确认删除。Go 测试另覆盖四客户端语法读写、未知字段、变量保留、同名与共享来源、损坏配置、命令和动态表达式不执行、独立身份不回落、备份恢复、写锁、Origin / Host / CSRF / 一次性令牌，以及 stderr 分块脱敏。

复验中发现旧目录适配器测试使用真实 HOME，触发设备目标关联校验；已改为临时 HOME 和独立数据目录。仅清理本轮在 HOME 新建、没有所选资源或操作的清单，未修改真实客户端配置。

中间运行曾出现 Pi 启动超过既有 15 秒用例期限，以及设备进度事件尚未到达时断言得到空数组的时序失败。未提高超时或弱化断言，最终六组完整回归共 115 项通过；这不代表已定位或修复原有时序波动。另外，测试与打包并行写入同一嵌入资源目录曾导致 Go 构建失败，之后改为串行验证；中断恢复测试改为等待实际文件与绑定完成同步，避免把操作已提交误当成同步已结束。

浏览器验收发现编辑器保留草稿时也保留了旧运行状态，启动成功后停止按钮仍不可用；已让操作按钮使用最新资源状态，同时保留编辑草稿。真实 MCP 会话启动、停止与外部配置变化后的失效均已复验。

Docker 最初两轮分别在镜像导出和依赖下载阶段触发 900 / 600 秒硬超时，失败日志保留在 `.data/local-management-docker-final.log` 和 `.data/local-management-docker-retry.log`。续验拆出锁文件 / workspace / 补丁下载层，使用独立 pnpm 缓存挂载；源码复制后离线安装，系统包层独立于应用构建。首次依赖和 Debian 包下载仍较慢，但最终类型检查、生产构建及两份镜像导出全部成功，没有改变依赖版本或忽略错误。

随后修改验收文档重新构建，确认 `pnpm fetch` 与 Git / CA 安装层均显示 `CACHED`，源码复制后的离线安装成功；缓存复查日志为 `.data/local-management-docker-cache.log`。

最新镜像已完成独立临时 Compose 验收：非 root 用户禁网运行 pnpm 10.12.4、新库迁移 0007 及重复迁移、临时设备配对与离线本地管理 API、Caddy 静态页、健康与登录 API、隔离 Sandbox 的单次文档和 CSP HTTP 契约，以及真实 Pi SDK / pi-mcp-adapter 发现和调用。Pi 测试保持 60 秒硬超时且不调用模型。新增本地管理断言已实际运行，所有临时容器、网络和卷均已清理；保留原开发数据库容器。构建与 Compose 日志分别为 `.data/local-management-docker-resume.log` 和 `.data/local-management-compose-resume.log`。

## 未验收范围

- Windows/Linux 原生本地服务、ACL、文件替换、锁和重启恢复。六架构编译不能替代原生系统测试。
- Cursor / Pi 桌面客户端真正重载，以及 Claude/Codex 交互式 Skill 使用。已安装客户端的 MCP 配置读取不能替代这些行为。
- 供应商 OAuth 登录态、真实跨物理设备、公网 WSS/HTTPS 和模型任务。未复制客户端 OAuth 状态，也未以本地协议服务代替供应商联调。
- 供应商管理的自定义目录需要标明只读；未知客户端选项和动态凭证表达式明确留待本机处理，不冒用另一种配置语义。

## 重现

```sh
pnpm db:migrate
pnpm check-types
pnpm lint
pnpm build
pnpm test
node scripts/check.mjs 60 go -C connector test -timeout 60s ./...
node scripts/check.mjs 60 go -C connector vet ./...
pnpm connector:build
# 需要 Playwright 与 Chrome；不添加到生产依赖
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check.mjs 60 node --import tsx scripts/verify-local-browser.mjs
# 需要已安装的 codex、claude，可通过 CODEX_BIN / CLAUDE_BIN 指定
node scripts/check.mjs 60 node --import tsx scripts/verify-local-clients.mjs
# 先构建最新 server/web 镜像；只启动专用临时项目并清理自己的卷
node scripts/check.mjs 600 node scripts/verify-compose.mjs
```

使用、接口、迁移 0007、凭证语义和备份恢复见 [本机管理与同步](local-management.md)。
