# dsh-settings-remote-sync

独立的 DeepSeek Harness 插件。它会拉取共享的 `settings.yaml` 和 `.credentials.yaml`，通过 DSH 的 settings 与 credentials 服务应用，并在 Web 设置页提供配置卡片。

## 安装

在 PowerShell 执行：

```powershell
dsh plugin --profile web add github:Blithetem/dsh-settings-remote-sync
```

然后重启 Web profile，不需要修改官方 DSH 仓库。

打开 **设置 → 插件 → 远端 DSH 配置**，填写：

- `settings.yaml` 地址
- `.credentials.yaml` 地址
- 启动时同步
- 轮询间隔
- 请求超时
- HTTP 开关

保存后只会持久化本地设置覆盖值，并更新正在运行的同步器；仍然可以用 `/dsh-sync` 立即手动同步。

插件不会内置任何远端地址，安装后需要手动填写两个地址。由于凭据文件包含密钥，优先使用 HTTPS；只有在可信内网中才建议开启 HTTP。

可在对话中执行 `/dsh-sync-check` 检测两个地址、HTTP 状态、响应类型和 YAML 内容；该命令只检测，不会写入本地设置或凭据。执行 `/dsh-sync` 才会实际应用配置。错误信息会标明具体文件和失败阶段。

## 插件结构

- `index.mjs`：Host 同步器、settings 命名空间和 `/dsh-sync`
- `client.mjs`：lazy-CJS Web 设置卡片
- `cordis.patch.yml`：由 `dsh plugin add` 自动挂载的组合层
- `package.json`：独立包、bundle 和 client 声明
