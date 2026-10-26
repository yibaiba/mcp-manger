# MCPHub 参考与迁移记录

本记录对照当前仓库代码，记录新平台可借鉴的实现和回归场景。已有 MCPHub 保持原运行方式；不把整个旧服务模块引入 `platform/`，也不迁移旧 OAuth 凭证。

## 本轮已落地

| 领域             | MCPHub 参考                                                                                                                                      | 新平台实现与验证                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 连接并发与清理   | [重建竞态测试](../../tests/services/mcpService-reinit-race.test.ts)、[定向重载测试](../../tests/services/mcpService-targeted-reload.test.ts)     | [ConnectionRuntime](../apps/server/src/modules/mcp/connectionRuntime.ts) 合并初始化，按连接串行执行创建、清理和状态写入；旧发现结果与旧失败不能覆盖新连接；新实例等待前一实例关闭                        |
| stdio 失败诊断   | [stdioDiagnostics](../../src/utils/stdioDiagnostics.ts)                                                                                          | [新诊断模块](../apps/server/src/modules/mcp/stdioDiagnostics.ts) 将脱敏 stderr 附到启动及调用错误；完整行写服务日志，错误详情保留最近 32 KiB，超长单行明确显示省略提示；分块传输的凭证也在整行拼接后脱敏 |
| 取消与下一次连接 | [请求选项测试](../../tests/services/mcpService-request-options.test.ts)、[传输错误测试](../../tests/services/mcpService-transport-error.test.ts) | 一次发现取消不会取消共用初始化或另一次发现；直连会话关闭后，下一次显式发现或调用重新建立会话，已发出的失败调用不自动重放                                                                                 |
| 旧配置迁移       | [配置校验](../../src/utils/serverConfigValidation.ts)                                                                                            | 导入映射 `cwd`，逐项展示错误和未映射字段；缺设备仍可预览，并可在界面选设备；未知传输不猜成 HTTP；应用前验证全部声明，避免部分导入                                                                        |

新回归覆盖见 [运行时单元测试](../tests/connectionRuntime.test.ts)、[诊断与取消测试](../tests/stdioDiagnostics.test.ts)、[真实 SDK/子进程/API 集成测试](../tests/mcpReliability.test.ts)。测试替身仅用于并发单元测试；运行路径没有模拟成功实现。

## 后续按能力迁移，不能视为已经支持

| 优先领域                 | 参考源码与测试                                                                                                                                                                                                                                          | 新平台现状与迁移要求                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompts、Resources、模板 | [MCP 服务](../../src/services/mcpService.ts)、[Prompts 测试](../../tests/services/mcpService-prompts.test.ts)、[真实客户端集成](../../tests/integration/sse-service-real-client.test.ts)                                                                | 当前适配器和外部入口仅有工具发现/调用；扩展时一并设计资源及 Prompt 的稳定标识、授权、分页和设备协议，不能直接暴露全部上游内容                          |
| 变更通知与元数据         | 同上；[MCP Apps 测试](../../tests/services/mcpService-apps.test.ts)                                                                                                                                                                                     | 补 tools/prompts/resources 的 listChanged、缓存更新与下游通知；保留 `_meta`、structuredContent 与原始错误语义；MCP Apps 还依赖资源读取和调用方能力协商 |
| OAuth 兼容与凭证隔离     | [OAuth Provider](../../src/services/mcpOAuthProvider.ts)、[客户端注册](../../src/services/oauthClientRegistration.ts)、[Provider 测试](../../tests/services/mcpOAuthProvider.test.ts)、[注册测试](../../tests/services/oauthClientRegistration.test.ts) | 新平台已有登录、Agent 接入与上游三类授权分离；继续移植静态 Authorization、发现 scope、注册方法持久化、issuer 和账号隔离的回归用例；供应商联调独立记录  |
| 协议版本兼容             | [分阶段升级 ADR](../../docs/adr/0003-mcp-2026-07-28-staged-upgrade-path.md)、[旧客户端包装](../../src/clients/legacyMcpClient.ts)、[真实客户端集成](../../tests/integration/sse-service-real-client.test.ts)                                            | 仓库 MCPHub 已使用拆分的 SDK v2 和双栈入口；新平台仍使用单包 SDK v1。SDK 升级、线上协议升级和三种传输覆盖应分别验证                                    |
| stdio 进程树与启动器     | [清理测试](../../tests/services/mcpService-stdio-cleanup.test.ts)、[缓冲区测试](../../tests/services/mcpService-stdio-buffer.test.ts)                                                                                                                   | 当前验证直接子进程退出；`npx`/`uvx` 的后代进程、Windows 进程树及服务自启动需继续移植与实机验收，不能用编译通过代替                                     |
| 请求头与会话隔离         | [安全请求头转发](../../src/utils/passthroughHeaders.ts)、[会话隔离测试](../../tests/services/mcpService-per-session-client.test.ts)                                                                                                                     | 平台已有静态上游请求头和配置授权；动态转发、私有上游会话及 cookie 作用域需单独迁移，平台接入凭证不能泄漏到上游                                         |
| 健康检查与连接恢复       | [KeepAlive 服务](../../src/services/keepAliveService.ts)、[测试](../../tests/services/keepAliveService.test.ts)                                                                                                                                         | 当前有连接状态、手动发现和设备重连；远程健康检查需显式配置，避免多余探测及并发恢复；恢复连接和重放工具请求分开处理                                     |
| 外部客户端配置           | [配置片段生成器](../../frontend/src/utils/mcpClientSnippets.ts)、[测试](../../tests/frontend/mcpClientSnippets.test.ts)                                                                                                                                 | 可以移植纯生成逻辑和各客户端配置格式；凭证使用新平台签发的接入密钥，不复用 MCPHub bearer key                                                           |
| OpenAPI 适配             | [OpenAPI 客户端](../../src/clients/openapi.ts)                                                                                                                                                                                                          | 属于 REST 到 MCP 的适配器，不是 MCP 传输协议；需要独立实现认证、Schema、文件参数及请求校验，当前导入会明确报告不支持                                   |

## 复用时保留的语义

- MCP 连接、授权和工具调用不依赖模型；Pi 的 MCP 桥接与内置 Agent 推理分别加载。
- MCPHub 在部分 HTTP/SSE 错误后重新调用工具；新平台不凭连接错误断言上游未执行，未知结果保持可诊断，避免重复副作用。
- MCPHub 的 [Schema 兼容校验器](../../src/utils/jsonSchemaValidator.ts) 对无法编译的输出 Schema 跳过校验。该兼容能力可以借鉴，但需要显式展示“输出未校验”及原始原因，不把跳过记成校验通过；本轮没有更改平台的 Schema 校验策略。
- 借鉴失败场景后，再通过新平台的 Hono/Drizzle、适配器和 Go 协议实现；旧 MCPHub 的全局 DAO、会话结构和 SDK v2 类型不直接跨项目引用。
- 新平台已有的工具分页不能因参考旧包装器的单页发现而回退；超时也不能代替底层取消。

验收结论以 [验证记录](verification.md) 为准；本轮未重跑旧 MCPHub 测试，也没有把本地协议测试记成 Cloudflare、Vercel、Windows 或两台实机验收。
