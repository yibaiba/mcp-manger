# Go 设备连接器

## 构建和配对

```sh
pnpm connector:build
./connector/bin/connector-darwin-arm64 pair --server https://平台域名 --config /absolute/private/connector.json
```

在管理界面生成配对码，粘贴到连接器提示；配对码十分钟内一次有效。连接器把设备 ID、32 字节无填充 Base64URL 长期密钥 `deviceSecret` 和 `credentialVersion` 写入权限 0600 的新文件，已有文件不会覆盖。长期密钥只在兑换响应返回，切勿提交或分享配置。远程必须 HTTPS/WSS；只有 loopback 开发允许 HTTP/WS。平台明确撤销后该设备不能通过重配恢复，须创建新设备。后台不会自动重放工具调用。

在生成的配置中设置实际可访问目录（替换为当前用户路径）：

```json
{
  "server": "https://平台域名",
  "deviceId": "配对产生的 UUID",
  "deviceSecret": "配对产生的32字节无填充Base64URL密钥，勿提交",
  "credentialVersion": 1,
  "skillRoots": { "claude-user": "/Users/your-user/.claude/skills" },
  "artifactRoots": { "work": "/Users/your-user/MCPFiles" }
}
```

Windows 使用 JSON 转义路径，例如 `C:\\Users\\your-user\\.claude\\skills`；Linux 使用 `/home/your-user/.claude/skills`。文件路径必须在配置目录内，禁止上跳、绝对相对路径混用及子路径符号链接。配置权限是执行权限的归属：运行该连接器的本地账户负责启动进程与访问文件。连接配置支持命令和参数数组，不经过 shell 拼接。

```sh
./connector run --config /absolute/private/connector.json
```

“连接已有服务”只连接 URL；“托管启动”由连接器持有子进程，关闭连接会清理进程。stdio 必须托管启动。HTTP 托管服务需要自己准备好监听；启动尚未就绪时会显式报告连接失败，不用固定 sleep 掩盖启动问题，可在服务就绪后刷新。

使用私有 CA 的平台可在 `pair`、`re-pair`、`run` / `connect` 时显式添加 `--ca-cert /absolute/path/to/ca.pem`。此证书只加入当前进程的信任池，保留系统根证书及主机名校验；文件缺失或无有效 PEM 证书会报错，不修改系统钥匙串。后台服务需要私有 CA 时，使用系统信任库安装该 CA。

## 设备认证与重新配对

0.3.0 与服务端一起升级，不兼容旧设备 Bearer 协议。每次 WSS 连接先接收 30 秒有效、仅当前连接可用的挑战，使用 HMAC-SHA256 应答，服务端成功后才注册业务通道。平台源站来自已配对的 `server`，服务端使用配置的 PUBLIC_URL，不信任转发头。DNS 主机名使用小写、去掉默认端口，IPv6 使用压缩形式；国际化域名建议使用平台地址的 ASCII/IDNA 形式。认证失败会明确记录，自动重连取得新挑战；不会重放业务请求。本机 `connector manage` 始终可离线使用。

在设备页点击“重新配对”，确认后**立即断线并使旧密钥失效**。设备 ID、MCP / Skills 绑定、目录配置和同步基线保留。重配码十分钟有效、单次使用；再次生成使上一枚失效。未兑换或过期后设备保持“待重新配对”。

```sh
connector re-pair --config /absolute/private/connector.json
# 配置遗失时必须明确指定原设备：
connector re-pair --config /absolute/private/connector.json --server https://平台域名 --device-id 原设备UUID
```

粘贴重配码，成功后重启连接器。命令原子替换凭证并移除旧 `token`，保留其余配置字段；已有本机管理数据目录无需重建。配置遗失时需自行恢复原目录设置，避免改变本机存储位置。兑换成功但本机保存失败会明确报错并提示设备 ID；服务端无法再次取回长期密钥，须在设备页生成新重配码再执行命令。

## 本机管理

连接器 0.3.0 可用 `connector manage` 无配对启动本机页；`run` / `connect` 在连接平台的同时提供该页面。终端输出一次性打开链接，只在 loopback 随机端口监听。未配对时也能扫描、搜索、编辑和管理连接器自己的会话；在设备页可管理已配对电脑的所选资源。

默认持久目录 `~/.mcplatform/local`；`--data-dir /absolute/path` 或配置 `localDataDir` 可覆盖。离线启动与已配对启动应使用同一目录。一个目录绑定一个平台设备并由单进程持有写锁；其他设备使用独立目录。此目录包含本机原始值和恢复副本，不在平台备份中。

客户端路径、同步基线、凭证引用、冲突 / 删除和备份恢复详见 [本机管理与同步](local-management.md)。写入配置仍显示客户端待重新加载，不能把连接器的连接成功当作桌面客户端实际加载。

## 自启动

安装时使用二进制和配置的绝对路径，移动二进制后重新安装。`install` 注册自启动；当前调试用 `run`。系统服务注册后通过系统服务管理器启动；卸载前先在系统管理器停止，再执行 `uninstall` 移除自启动，不删除配置。查看连接器终端或系统服务日志中的错误。

| 平台    | 后台服务                                                                                     | 需要桌面的应用                                                                                          |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Windows | 管理员终端 `connector.exe install --scope system --config C:\\...\\connector.json`，SCM 服务 | 当前用户 `--scope user`，任务计划程序 ONLOGON、交互会话；需要用户登录                                   |
| macOS   | `sudo ./connector install --scope system --config /.../connector.json`，LaunchDaemon         | `./connector install --scope user --config /.../connector.json`，LaunchAgent                            |
| Linux   | `sudo ./connector install --scope system --config /.../connector.json`，systemd              | `./connector install --scope user --config /.../connector.json`，systemd user；图形会话环境需由本机配置 |

Windows 不依赖 POSIX 文件模式保护配置，应在文件属性或 `icacls` 中只授予实际运行账户访问。系统服务不能替代登录会话访问桌面；自动化软件的权限、桌面会话、PATH/环境和应用安装必须在目标设备实测。管理界面显示 OS、主机名、心跳和各 MCP 服务状态，可定位设备离线与 MCP 错误。

## Skills 和文件

选择不可变 Skill 版本、Agent 配置、设备和 `skillRoots` 名称后安装。回滚也是安装指定旧版本。已管理目录被用户改动时报告冲突并保留内容；不会执行导入包内脚本。成功仅表示文件分发完成，返回 `reloadRequired: true`、`loadedVerified: false`。在 Claude Code 新会话中核对 Skill 列表，触发 Skill 并执行已授权 MCP 后，才能记录“实际加载成功”。

设备 A “发送文件到平台”返回产物 ID；设备 B “接收平台产物”通过一次性传输令牌流式下载并核对 SHA-256，目标文件已存在时报错而不覆盖。把最终产物 ID 加入 Agent 配置即可使用 [授权下载接口](api.md)。
