# 服务市场、智能发现与 REST

全部入口使用应用的同一端口（默认 4300）。现有 direct Profile 不需要模型；安装镜像不默认安装第三方 MCP 包。

## 官方服务市场

管理页面「服务市场」使用 [官方 Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md)，流程为搜索、版本详情、运行方式、执行位置、参数和秘密、预览、安装并连接。支持 npm、PyPI、Streamable HTTP 和 SSE；其他包类型显示原因。

预览将固定版本编译成 command 和 argv 数组，参数不会拼成 shell 命令。安装时重新读取声明并核对预览摘要；声明变化需重新预览。连接保存来源和版本；必须真实发现成功才显示「已连接」。下载、授权、启动失败保留连接及诊断状态，不能将保存成功当作连接成功。PyPI 可显式指定包提供的可执行文件名称。

`GET /api/v1/market/servers`、`/server?name=…&version=…`、`/versions?name=…`、`POST /preview` 和 `/install` 都需要管理登录。官方搜索的字符规则由 Registry 校验并返回错误。

## Profile 语义搜索

「智能发现」提供 `direct`（默认）和 `search`。搜索模式暴露 `platform_tools_search`、`platform_tools_definition`、`platform_tools_call`、已授权的钉选工具及现有权限工具。内部 Pi 使用相同发现服务。实际调用仍进入统一调用、隐藏参数验证和交互链路，使用内部稳定 ID。

Embedding 单独设置 OpenAI 兼容 `baseUrl`、`model`、可选 `dimensions`、`timeoutMs` 和 `batchSize`；`apiKeyRef` 只读取当前账号保存的秘密。配置与 Pi 推理模型无关。服务收到已授权工具的生效定义和查询文本；选择远程服务时这些内容会发送到该地址。

向量使用 PostgreSQL `double precision[]`。先取得当前权限与共享授权的交集以及当前身份的实际目录，再建立向量；作用域包括账号、Profile、身份、绑定版本、共享版本、客户端能力及模型配置。目录、模型或身份变更后，下次查询按新作用域或定义摘要更新；不复用其他身份的目录。索引并发构建返回 `SEARCH_INDEX_PENDING`；服务失败、维度错误等明确报错，不改用关键词搜索。返回检索结果前再次检查目录及权限。

搜索读取缓存，不唤醒停止或休眠连接。当前身份没有缓存时，只有该接收账号的来源服务仍连接着，才允许为当前客户端初始化真实目录；否则返回 `SEARCH_CATALOG_PENDING`，需显式连接和授权。搜索模式的初始化说明使用 Profile 自己的说明，避免为聚合上游说明唤醒服务。实际工具调用沿用现有唤醒流程。

`GET /api/v1/profiles/:id/context-footprint` 使用本地 `gpt-tokenizer` 的 `o200k_base` 编码估算最终定义，返回完整目录与当前暴露工具数、Token 数及 `estimated: true`。这不是模型账单，也不调用模型服务。

模板包含 `discoveryMode`、`embedding` 和按连接逻辑名/原工具名引用的 `pinnedTools`；导出不包含 API 密钥。

## MCP → OpenAPI 与 REST

使用当前 Profile 的 Agent key 或 OAuth access token：

```text
Authorization: Bearer <profile-token>
GET  /mcp/:profileId/openapi.json
POST /mcp/:profileId/rest/tools/:toolId
GET  /mcp/:profileId/rest/calls/:callId
GET  /mcp/:profileId/rest/calls/:callId/result
POST /mcp/:profileId/rest/calls/:callId/answer
POST /mcp/:profileId/rest/calls/:callId/cancel
```

OpenAPI 3.1 的路径使用稳定内部工具 ID，`operationId` 使用生效展示名。工具 POST 的 JSON body 就是工具参数，不需再包一层 `arguments`。正常完成返回实际 MCP 结果，包括 `isError`、`content`、`structuredContent`；响应 `X-Call-Id` 标识原调用。

每个工具输入 Schema 使用独立 `components.schemas` 项，局部 JSON Pointer 引用同步调整，避免不同工具的 `$defs` 相互冲突。转换仅遍历 Schema 字段，不改写默认值和示例中的业务数据；显式 `$id` 定义的独立引用作用域保留。作用域遵循 [OpenAPI 3.1 Schema Object](https://spec.openapis.org/oas/v3.1.0.html#schema-object)。

需要回答时返回 202、`callId`、`interactionId`、`inputRequests` 及 `links`。回答格式：

```json
{
  "interactionId": "<本轮交互 UUID>",
  "responses": {
    "<inputRequests 中的请求 ID>": { "action": "accept", "content": { "answer": "yes" } }
  }
}
```

支持 `accept/decline/cancel` 和 form/URL 交互。每轮交互有不同 ID；重复回答或旧 ID 返回 409。回答继续原调用，共用剩余执行预算，等待用户回答期间预算暂停。REST 不提供 Apps 渲染宿主，也不创建 Apps 会话；原始工具数据仍返回。

`Idempotency-Key` 绑定账号、Profile、原凭证和请求摘要。同一 key 和同一请求返回既有调用；key 相同但请求不同返回 409。并发请求只执行一次。失败、取消、重启中断及结果保存失败都不会触发重放。终态未知/失败返回 409，结果保存失败返回 500；只有执行中/等待回答返回 202。

状态、结果、回答、取消都匹配原账号、Profile 和凭证，并重新检查当前权限。另一个 Agent key 即便属于同一 Profile，也不能读取原调用。

完成结果以 AES-256-GCM 加密文件保存于数据目录 `rest-results/`，使用现有 `ENCRYPTION_KEY`，认证附加数据绑定调用身份；文件写入和目录重命名完成同步后才登记数据库摘要。数据库仅存索引和状态。备份必须同时包括数据库、数据卷与加密主密钥；回退恢复匹配版本备份。执行中或等待回答的调用在重启后标记结果未知，绝不恢复执行。

## 本地验证记录

- 官方 Registry 实际 HTTP 查询成功；市场专项覆盖固定版本 argv 和真实 HTTP Registry→MCP 安装发现。额外从官方声明安装固定 npm `@j0hanz/filesystem-mcp@2.11.0` 和 PyPI `vs-filesystem-mcp-server==0.1.4`，实际初始化发现分别为 7 和 8 个工具。脚本 `scripts/verify-market-runtime.mts`；这项验证没有执行第三方文件修改工具。
- 搜索覆盖真实 MCP 客户端、索引身份隔离、停止连接不重连、撤权复检、Embedding 协议错误和本地 Token 估算。Embedding 服务使用协议夹具，未连接真实供应商。
- REST 覆盖真实 OpenAPI 客户端、并发幂等、两轮 form/URL、重复回答、取消、加密结果及身份绑定。最终 Compose 实际重启容器后仍能解密读取完成结果，执行中/等待回答标记未知；幂等记录和真实副作用文件证明没有重放。专项共 13 项，最终完整后端回归 200 项通过；新增旧连接器截止时间竞态用例后，相关 17 项通过，共覆盖 201 项唯一用例，每个进程保持 60 秒硬超时。
- 本地内存余弦及排序基准：1536 维、5 次中位数，1 千工具约 44.2 ms、1 万工具约 55.1 ms，不含数据库和推理。
- PostgreSQL 实际数组读写及精确检索基准：1536 维合成向量、3 次检索，1 千工具检索中位数约 2091.8 ms，1 万约 26308.3 ms；初次批量写入分别约 10.5 秒、95.5 秒。包含数据库读取、反序列化、余弦和排序，不包含 Embedding 推理和 MCP 目录投影。脚本 `scripts/benchmark-discovery-db.mts`。结果反映本地环境中大目录的明显延迟，不据此设置数量上限或改用关键词降级。
- Chrome 验证官方市场搜索/详情、发现模式/钉选工具保存、Token 估算、1365×1000 和 390×844 布局。Apps 浏览器隔离回归通过。
- 用户未提供真实 SSO、Embedding 服务或目标设备环境，这三项外部实机联调未执行。协议夹具、当前主机 Go 连接器和 ARM64 仿真不替代对应供应商或目标硬件结论。
