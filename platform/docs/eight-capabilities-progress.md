# 八项能力补齐实施状态

本文件记录本轮实际交付，不代替用户批准的四阶段计划。工作开始时分支为 `feat/multi-device`，存在单端口部署、Apps、设备桌面端及外层 MCPHub 的未提交改动；本轮没有回退这些改动。

| 阶段                         | 状态                       | 本轮范围                                                                                              |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| 一：Python 与连接稳定性      | 实现已落地；arm64 验收受阻 | 固定 Python/uv 镜像、可写缓存、预算配置及续期、跨轮累计、后台恢复及 UI、删除清理、Go 心跳连接标识修正 |
| 二：用户、共享和日志         | 未实施                     | admin/member、SSO、跨用户共享、分页日志、持久化系统日志、metrics、清理                                |
| 三：生效目录和声明式模板     | 未实施                     | 别名/描述/隐藏字段投影、manifest、secretRef、自动推进与冲突处理                                       |
| 四：市场、发现、OpenAPI/REST | 未实施                     | Registry、Embedding、tokenizer、OpenAPI 导出、可续传 REST、幂等与加密结果                             |

本轮尚未形成阶段提交，也未合并主分支。阶段一涉及的 Dockerfile 依赖工作开始前已有的单应用镜像改动；不能把整个工作区的修改视为本轮新增。

## 第一阶段证据

- 配置与操作说明：[连接稳定性](connection-reliability.md)。
- 类型检查和 lint 已通过。
- 预算单测覆盖进度续期、无效进度、累计总期限及等待暂停；恢复单测覆盖倍增、抖动、成功归零、关闭及不可恢复错误。
- 真实 stdio 测试覆盖 direct、Pi 和本机实际 Go 连接器的进度续期与总期限；真实 HTTP 测试覆盖首次发现失败后自动恢复目录且无工具调用。
- 首次全量回归发现订阅 listen 确认计时及停止清理两处问题，已修复。后续全量运行出现 Pi 目录测试的 15 秒测试超时，同时暴露 Go 心跳错误使用会话键而非连接 UUID；已修正心跳、添加 Go 回归测试。最终完整执行 `pnpm test` 的 7 组、145 项测试全部通过，每组保留 60 秒硬超时。完整日志：`.data/capabilities-tests-verified.log`。
- 最终 amd64 应用镜像构建通过；镜像内 direct/Pi 的真实 Python MCP 冷缓存联网及热缓存禁网检查均通过，UID 1000、Python 3.13.9。日志：`.data/capabilities-image-final.log`、`.data/capabilities-python-final.log`。
- 实际 Chrome 已验证续期未设置总时长时明确报错、保存超时与恢复设置、展示自动恢复状态；桌面和 390px 移动视口截图在本地 `.data/capabilities-*.png`。
- Apps 实际 Chrome 回归通过：双层 opaque origin、父窗口 DOM/Cookie/storage 隔离、原结果与 App 工具调用、全屏保持同一 iframe、主题、关闭及 teardown。使用临时测试账号，保留原验收脚本的全部隔离断言；本轮截图：`.data/capabilities-apps-success.png`。
- 单端口 Compose 验收通过：新库/重复迁移、登录/API/静态页、禁网 pnpm、Apps HTTP/CSP 契约、真实 Go HMAC 通道重连/重配/撤销、真实无模型 Pi。日志：`.data/capabilities-compose-final.log`。临时容器、账号和卷已清理。
- Go 全包测试及 `go vet ./...` 通过，测试进程有 60 秒硬超时。日志：`.data/capabilities-go-tests.log`。
- 本轮差异补丁：`.data/capabilities-stage1.diff`；文件清单：`.data/capabilities-stage1-files.txt`。这些本地工件排除开始前的修改，不应据 `git diff` 的总量归属本轮改动。

## 尚未完成的验收

- linux/arm64 完整应用构建在拉取 Docker Hub 的 `node:24-bookworm-slim` manifest 时 TLS 握手超时失败，未完成构建或运行。日志：`.data/capabilities-arm64-build.log`。需在可访问该 registry 的环境或原定 Linux amd64 发布 runner 中完成验证；未替换镜像源或将失败标为通过。
- 两账号共享、真实 SSO 供应商、Embedding、目标设备实机、模板全新环境和 REST 重启持久化：对应实现尚未完成，不以夹具替代。
- 四阶段提交与合并。
