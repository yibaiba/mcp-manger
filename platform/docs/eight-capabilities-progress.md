# 八项能力补齐实施状态

八项能力按四阶段实现，保持独立 `platform/`、单应用镜像、单域名和 4300 端口。发布仍由 `release.published` 触发，手动流水线只验证构建；镜像发布在 Linux amd64 runner 构建 amd64/arm64。原工作区已有的外层 MCPHub、设备桌面端和部署改动未被覆盖，阶段提交在隔离工作区整理。

| 阶段 | 实现及验收 | 提交 |
| --- | --- | --- |
| 一 | Python 3.13.9/uv 固定运行环境、统一预算、可选后台恢复 | [PR #4](https://github.com/yibaiba/mcp-manger/pull/4) |
| 二 | admin/member、账号启停与 SSO、两种共享身份、调用记录、持久日志及 metrics | [PR #5](https://github.com/yibaiba/mcp-manger/pull/5) |
| 三 | 统一目录投影、别名/隐藏参数、版本化 manifest 与自动推进 | [PR #6](https://github.com/yibaiba/mcp-manger/pull/6) |
| 四 | 官方 Registry、授权目录语义检索及 Token 估算、OpenAPI/可续传 REST | [PR #7](https://github.com/yibaiba/mcp-manger/pull/7) |

## 自动化与真实运行验证

第一阶段独立 145 项、第二阶段独立 169 项、第三阶段独立 187 项唯一后端用例完成验证。第三阶段发现 Go 截止时间先于平台计时器返回的竞态，已将该错误明确归类 `RESULT_UNKNOWN`，相关 6 项重跑通过；其他用例首次通过。最终完整后端回归 200 项通过；随后新增旧连接器截止时间竞态回归，相关 17 项通过，共覆盖 201 项唯一用例。每组进程硬超时保持 60 秒。类型检查、lint、前端构建及 Go 全包测试/vet 通过。

amd64、arm64 应用镜像均构建成功。两种架构已实际验证 Python MCP 在 direct/Pi 中的初始化、发现与调用，覆盖冷缓存联网和热缓存禁网、Python 3.13.9、UID 1000。ARM64 使用本机仿真，不声称在 ARM64 实机执行；仿真集成显式设置 600 秒连接期限。已修复嵌入式 Pi 适配器内部 30 秒初始化等待，由平台连接预算管理取消。末次平台兼容修复用可控时钟与真实 WebSocket 验证旧连接器截止时间先返回的情况，未更改协议要求。

单端口 Compose 完成全新数据库和重复迁移、登录/API/静态页、禁网 pnpm、实际 Go HMAC 通道重连/重配/撤销、真实无模型 Pi 和 Apps HTTP/CSP 契约验证。一份 manifest 在新库中应用、秘密补齐后自动解析精确能力、重复应用保持幂等。实际重启应用容器后，完成的 REST 结果仍能解密读取，执行中/等待回答状态为未知；幂等记录与副作用文件证明没有重放。

Chrome 验证连接设置与恢复、用户/个人账号、共享、调用与系统日志、目录模板、官方市场与智能发现的桌面/移动界面。Apps 双层 opaque origin、父窗口 DOM/Cookie/storage 隔离、原结果与工具调用、全屏 iframe 身份、主题和 teardown 回归通过。PR 截图标注视口与临时测试数据并检查上传后的加载状态。

官方 Registry 固定 npm/PyPI 包已真实下载并发现工具。PostgreSQL 1536 维精确检索基准包含数据库读取/反序列化/余弦/排序：1 千工具约 2.09 秒，1 万约 26.31 秒；不包含 Embedding 推理及目录投影，不据此设置硬上限或静默降级。

## 尚未执行的外部联调

用户暂未提供真实 Google/GitHub/OIDC 供应商配置、OpenAI 兼容 Embedding 服务或目标设备。这三类外部联调未执行；本地 OIDC/Embedding 协议夹具、当前主机 Go 连接器及 ARM64 仿真不能替代对应供应商和硬件结论。

## 操作与复现

- [连接运行环境、预算与恢复](connection-reliability.md)
- [用户、共享、日志及指标](users-and-observability.md)
- [统一目录及配置模板](catalog-and-templates.md)
- [市场、发现、OpenAPI 与 REST](market-discovery-rest.md)

后端运行 `pnpm check-types`、`pnpm lint`、`pnpm test`；Python/Compose/Registry 与检索基准的独立脚本在 `scripts/verify-python-runtime.mjs`、`verify-compose.mjs`、`verify-market-runtime.mts`、`benchmark-discovery-db.mts`。执行前准备隔离数据库和数据卷并设置明确的外层超时。升级前备份数据库、数据卷和加密主密钥，回退必须恢复匹配版本备份，不假设旧程序理解新增授权模型。
