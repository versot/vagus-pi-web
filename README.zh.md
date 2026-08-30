# vagusPI

[English](README.md) | 中文

vagusPI 是一个开源的 **[pi 编码智能体](https://pi.dev) 的 Web 图形界面**。

它不是独立 agent，也不是隔离的工作台。vagusPI 读写的是 pi CLI 使用的**同一套** `~/.pi/agent` 配置——模型、会话、包与设置完全互通。你在浏览器里做的一切，终端里都能用，反之亦然。你的数据始终留在本机。

## 运行

### 通过 `npm` 运行

安装 `Node.js >= 22`，然后运行：

```sh
npx @versot/vaguspi web
```

该命令会启动 Web UI（默认 `http://127.0.0.1:19707`）并在默认浏览器中打开。无需安装。

### 作为 pi 包安装

```sh
pi install npm:@versot/vaguspi
```

然后启动：

```sh
pi-web web
```

## 功能

- **对话** — 流式输出，可视化思考过程、工具调用卡片与多轮对话
- **会话历史** — 真实的 pi 会话文件，可在 Web 或终端恢复；长会话滚动懒加载
- **模型管理** — 可视化配置 Provider（API 类型、Base URL、密钥、模型列表、推理等级），实时校验凭据
- **内置 MCP** — MCP 服务器按会话工作，无需单独安装适配器
- **技能与命令** — `/` 命令面板列出 pi 命令、扩展命令、技能与模板
- **用量统计** — 跨会话的 token 与费用汇总

## 开发

Agent 请遵循 [AGENTS.md](AGENTS.md)。

```sh
pnpm install
pnpm build             # 构建 host 包
pnpm build:web         # 构建 Web UI + CLI 产物
pnpm test              # 单元测试
```

## 贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[MIT](LICENSE) © versot
