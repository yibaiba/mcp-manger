# 原生桌面连接器

桌面端使用 MyGo v0.7.1 的 Native UI：界面由 Go 绘制，不启动 WebView，不需要 WebView2 或 WebKitGTK。构建使用 `CGO_ENABLED=0`，需要 Go **1.27.3+**。它与 CLI 共用配对、设备认证、本机资源管理和 MCP 会话实现。

## 构建与启动

在 `platform/` 运行：

```sh
pnpm connector:desktop:build
```

构建无需 Node 前端编译；这里的 pnpm/Node 只运行跨平台构建脚本。产物位于 `connector/bin/desktop/`，包括六个目标的程序、macOS `.app`、Linux `.desktop` 文件和 `SHA256SUMS`。

图标源文件为 `connector/internal/desktop/branding/mark.svg`。构建脚本使用现有 MyGo 内存渲染器导出蓝底应用 SVG/PNG、彩色和单色托盘 SVG/PNG 及多尺寸 `.icns`，不增加 CGO 或外部图形工具依赖。macOS `.app` 在 `Contents/Resources` 中包含 `.icns` 并配置 `CFBundleIconFile`；运行时也会设置 Dock 图标，Windows/Linux 设置窗口图标。单独重新导出可在 `connector/` 运行 `CGO_ENABLED=0 go run ./scripts/icons`。

- macOS：使用对应架构目录里的 `MCP Platform Connector.app`，建议移至“应用程序”后启动。
- Windows：启动 `connector-desktop-windows-amd64.exe` 或 ARM64 版本，不会弹出控制台。
- Linux：把对应程序放到固定位置，并使 `.desktop` 中的 `Exec` 能找到该程序。模板使用程序文件名；可将程序安装到用户 PATH，或把 `Exec` 改为安装后的绝对路径（含空格时按 Desktop Entry 规则引用），然后把 `.desktop` 放入 `~/.local/share/applications/`。

也可直接启动并选择路径：

```sh
./connector/bin/desktop/connector-desktop-linux-arm64 \
  --config /absolute/private/connector.json \
  --data-dir /absolute/private/local \
  --ca-cert /absolute/private/platform-ca.pem
```

三个参数均可省略，也可在“设置”里选择。命令行显式值覆盖已保存的桌面设置。默认配置是 `~/.mcplatform/connector.json`；本机数据沿用 `~/.mcplatform/local`，配置中的 `localDataDir` 和显式数据目录仍然生效。桌面设置保存到 `~/.mcplatform/desktop.json`，登录启动会读取这些路径。

## 使用

1. 首次运行可直接离线扫描和管理本机资源。在平台设备页生成配对码，在“设备连接”填写平台地址和配对码。
2. 配对成功并保存凭证后自动连接。重新配对使用平台新生成的重配码，保留原设备及本机配置。
3. MCP、Skills 和扫描来源提供原本本机网页的管理能力；操作记录可以载入修改前副本或确认恢复。编辑草稿在切换资源时保留；来源变化不会覆盖草稿，保存仍执行修订与摘要冲突检查。
4. 平台端的 Agent 授权、同步副本冲突处理和 Skill 版本管理继续在平台网页完成。凭证绑定在本机 MCP 详情中编辑。
5. 已配对设备每次启动自动连接。关闭窗口后驻留托盘；使用托盘的“显示设备连接器”恢复窗口，选择“退出连接器”关闭平台连接、MCP 会话及托管进程。托盘不可用时显示真实错误，关闭窗口会退出程序。

登录自启动默认关闭。在“设置”勾选“登录后自动启动并驻留托盘”后，由当前用户的登录会话启动：macOS 登录项、Windows Run 注册项、Linux XDG autostart。它与 CLI 的系统服务安装独立；不要让已有 CLI 服务与桌面端同时持有同一个本机数据目录。移动程序后重新设置登录启动。macOS 的登录项需要 `.app`。

桌面端为每个用户运行一个实例；再次打开会唤起已有窗口。数据目录另有跨进程写锁，已有 CLI 占用时会明确报错。

## 系统依赖与验收

无 CGO 指不需要 C 编译器参与构建，并不代表运行时没有系统动态库依赖。Linux 原生界面使用 GTK 3、GDK、GLib/GIO、Pango、Cairo、GdkPixbuf 和 OpenGL；托盘还需要 Ayatana AppIndicator 或 AppIndicator，以及桌面环境的托盘支持。缺库及托盘错误直接报告。

首版构建目标为 macOS、Windows、Linux 的 amd64/arm64；**不包含 loong64**。麒麟 ARM64 已提供的 GLib 2.64.6 / GTK 3.24.23 满足此前检查到的 API 下限，实际显示、输入法、OpenGL 与托盘仍需在该设备验证。

当前自动验证覆盖无 CGO 六目标构建、已有 Go 测试、认证状态、订阅通知、存储锁释放、原生界面导航和编辑草稿。界面测试使用 MyGo 的内存渲染器，不能替代 Windows/Linux/macOS 实机的托盘、中文输入法、登录启动和图形驱动验收。构建产物尚未进行发行签名、公证或安装器封装。

诊断日志位于 `~/.mcplatform/connector-desktop.log`，本机页会显示操作错误；日志和本机目录可能涉及本机路径或服务诊断，不属于平台备份。
