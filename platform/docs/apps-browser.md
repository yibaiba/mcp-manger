# Apps 浏览器验收

2026-10-27 使用独立 Chrome + Playwright 1.58.2，未读取用户 Chrome 的登录资料。平台、Sandbox、MCP 服务均为实际本地进程；没有关闭 iframe sandbox、CSP 或浏览器进程沙箱。

## 已验证

- 工具测试页：AppBridge 初始化、原始参数/结果、App 专用工具调用、主题变化、尺寸通知、内联/全屏、取消通知、卸载回调和 iframe 移除；没有广告 message 模型会话能力。
- 官方 [basic-server-vanillajs v2.0.3 示例](https://github.com/modelcontextprotocol/ext-apps/tree/v2.0.3/examples/basic-server-vanillajs)：原始 UI TypeScript/CSS 与 `createServer` 工厂未改业务逻辑。UI 用平台现有 Vite 打包并内联；本地 HTTP 入口使用 SDK `createMcpHandler`，没有运行示例的 Express `main.ts`。get-time 初始结果与按钮再次调用返回实际服务器时间；关闭前收到官方 `onteardown` 回调。
- 浏览器实际拒绝 App 读取顶层平台 DOM、读取 Cookie，以及执行 CSP 未声明的管理 API 网络请求。测试没有向 App 提供平台 Cookie 或密钥。
- 任务页：用明确标记的宿主夹具记录关联一次真实 Pi MCP 桥接调用，展示官方 App；`ui/message` 只进入待发送文本，没有新增推理任务。刷新返回视图已结束，调用记录数量不变。这是无模型宿主集成测试，不是模型生成任务的通过结论。

浏览器复现修正了两个问题：SDK 自动添加的 `_meta` 曾被原样传入严格的管理接口 DTO，导致 App 内调用返回 400；关闭按钮曾先移除 iframe，官方卸载处理器没有运行。现在桥接明确映射 name/arguments/uri，转交取消信号；关闭先等待卸载握手，再移除视图，卸载错误仍显示。上游协议元数据不作为工具业务参数传递。

原 Chrome 控制工具仍会将跨源文档停在暂停状态，外层 iframe 因而保持空白；用户授权改用命令行 Playwright 后，独立浏览器取得了真实初始化和交互证据。没有通过放宽产品隔离设置绕过该工具问题。

## 重复运行本地宿主回归

先配置并启动本地平台与 Web（4300/4301/4302），在这个开发环境启用注册。脚本会创建专用测试账号、连接与调用记录，结束时停止测试连接，不删除已有账号或连接。

```sh
pnpm --filter web exec vite build --config test-fixtures/vite.config.ts
node scripts/check.mjs 1800 pnpm exec tsx tests/browserApps.mts
```

上面的真实 MCP 夹具监听 54820，保持运行。在另一终端安装独立的 QA 工具；它不属于平台运行依赖，也不改平台 lockfile：

```sh
apps_qa_dir="$(mktemp -d)"
pnpm --ignore-workspace --dir "$apps_qa_dir" add playwright@1.58.2
PLAYWRIGHT_MODULE="$apps_qa_dir/node_modules/playwright/index.mjs" \
  node scripts/check.mjs 180 node scripts/verify-apps-browser.mjs
```

需要本机已安装 Google Chrome。浏览器使用新建的隔离资料目录，保留 Chromium sandbox。脚本检查页面异常与失败响应；浏览器自动请求、但本项目没有提供的 favicon 404 不参与业务成功断言。成功/失败截图分别保存到忽略的 `.data/browser-acceptance/success.png`、`failure.png`。官方示例与任务页专项截图也只保留在本机该目录，没有放入发布包。

公网 Apps 域名/HTTPS、实际模型任务的完整取消链及外部客户端展示仍需要部署或账号环境；本地通过不替代这些验收。
