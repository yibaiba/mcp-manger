# 内置 Pi：配置与验证

Pi 运行时是平台工作区依赖，执行一次平台根目录的 `pnpm install --frozen-lockfile` 即安装全部依赖，默认 Docker 镜像也包含 Pi。无需全局安装 Pi CLI 或额外安装运行时。

## MCP 连接与 Agent 任务

MCP 连接、授权、工具发现和调用均不需要配置模型。选择 Pi 桥接后，平台会按需加载运行时；即使 `PI_ENABLED=false`，Pi 桥接也可直接使用。

只有执行内置 Agent 推理任务时，才需要在 `.env` 设置 `PI_ENABLED=true`、`PI_MODEL_PROVIDER`、`PI_MODEL_ID` 和模型供应商凭证，然后重启平台。Docker Compose 部署执行 `docker compose up -d server`，无需重建镜像。

运行时使用官方 `@earendil-works/pi-coding-agent@1.4.0` SDK，已包含 `@earendil-works/pi-agent-core@1.4.0`，同时提供平台所需的会话、Skills 与扩展支持；MCP 桥接使用 `pi-mcp-adapter@7.0.0`。所有版本由平台根目录的 `pnpm-lock.yaml` 统一锁定，`integrations/pi` 是平台工作区中的运行时模块。

`PI_ENABLED` 仅控制内置 Agent 任务，不控制 Pi 桥接或依赖安装。设置 `PI_ENABLED=false` 时，平台登录、直连、设备连接、Pi 桥接、统一入口、Skills 分发和文件流转继续工作。

Pi 桥接支持 Streamable HTTP、旧版 HTTP+SSE 和 stdio。远程地址可用 HTTP/HTTPS；stdio 提供启动命令、参数、环境变量和工作目录，由平台主机（Docker 的 server 容器）执行，不在浏览器所在电脑执行。远程设备上的进程使用设备连接器。

两条执行路径：

1. **MCP 桥接**：每个用户/连接独立子进程、Pi 目录和服务器名，由 pi-mcp-adapter 持有授权与执行。使用 SDK 的原始工具定义调用代理，不构造模型消息、不请求模型。禁用输出改写以保留 MCP content/structuredContent，网关照常记录调用和权限。
2. **内置 Agent**：设置 `PI_MODEL_PROVIDER`、`PI_MODEL_ID` 和该供应商的环境凭证；在任务页选择配置执行真实模型推理。只注入该配置的 MCP 工具及 Skill 版本，不继承主机的全局扩展、Skills 或内置 shell 工具。Skill 的 SKILL.md 通过 Pi loader 加载并注入任务指令；辅助文件会落盘，但不会额外授权任意宿主机文件访问或脚本执行。

Pi OAuth 使用 `encrypted-file` store；按 pi-mcp-adapter 文档生成 `PI_MCP_ADAPTER_OAUTH_FILE_KEY`，妥善备份（32 字节密钥的 base64 表示）。凭证目录保存在持久化 DATA_DIR 下，进程之间隔离。平台 SQL 加密密钥与 Pi 文件密钥职责不同。

UI 授权支持 auth-start、手工完整 redirectUrl 完成授权和 logout。自动授权关闭，错误明确返回；logout 后读取实际 token 状态，未清除或无法读取会报错。供应商侧授权仍需供应商账户撤销。无模型桥接验收不能证明 Vercel OAuth 已验收。

## 已执行与待实测

`pnpm test:pi` 通过真实 Pi SDK + pi-mcp-adapter 对本地官方 MCP SDK 服务发现和调用，核对原始 structuredContent，全程未配置模型。此测试通过工作区包名加载随平台安装的运行时，60 秒硬超时。

仍须实测：Vercel OAuth 登录/刷新/撤销/重启恢复；配置实际模型后完成一次任务；Pi 实际使用 Skill 的辅助资源；供应商错误、模型中断和真实执行成本。当前没有提供这些账号与模型设置，不记录为通过。

参考官方资料：[Pi SDK](https://pi.dev/docs/latest/sdk)、[适配器嵌入接口](https://github.com/nicobailon/pi-mcp-adapter/blob/main/docs/extension-api.md)、[OAuth](https://github.com/nicobailon/pi-mcp-adapter/blob/main/docs/auth.md)。
