# 在线体验与密钥边界

在线版仍仅展示：对话分流、五项打样参数补齐与改口确认、BOM 合并与异常标记。没有增加账户体系、库存、图纸识别或真实客服平台。

## 运行方式

### 当前选择：Vercel

由于 Sites 的 `chatgpt.site` 域名在目标网络被拦截，迁移到 Vercel，保留同一套职责展示。

1. 导入 GitHub 的 `FriendRan/material-copilot-demo`，框架选择 Other。仓库 `vercel.json` 已配置 `public` 静态目录与两个 `/api` 服务端入口，无需框架构建或生产依赖安装。
2. 在项目的生产环境变量中添加 `DEEPSEEK_API_KEY` 和随机生成的 `DEMO_SESSION_SECRET`，均使用 Sensitive / Secret 存储；可选设置 `LLM_MODEL=deepseek-flash`。不在网页或 GitHub 填写真实值。
3. 发布后以匿名访问核对首页、静态资源、会话接口和真实模型请求，并在目标网络确认可达。正式 URL 验证完成后才加入 README。
4. `.vercelignore` 额外排除本机 `.env`、Git 元数据、依赖及测试资料。Vercel 的 API 入口复用在线校验与会话逻辑。

### 已验证构建的 Sites 备选入口

`online/worker.mjs` 提供 Worker 运行入口。`node scripts/build-online.mjs` 将公开 HTML/CSS/JS 和服务端处理代码构建为 `dist/server/index.js`。原有 `node server.mjs` 本地方式保持可用。

构建只读取公开资源白名单与代码文件，不读取 `.env`。部署归档仅包含 Worker 构建产物和 hosting manifest，不包含本机环境文件、依赖、个人资料或测试记录。Sites 备选项目的密钥单独存于 Secret 配置，未写入源码；这个域名不作为当前面试入口。

Sites 部署工作副本由 `.openai/hosting.json` 绑定到固定项目；以后更新必须复用同一个项目 ID。GitHub 保留可复现的构建脚本与 Worker 源码，托管副本不包含本地密钥。

## 访问与请求限制

- 公开页面可以匿名打开，离线规则演示无需模型调用。
- 模型请求通过同站点 `/api/chat`，浏览器不直接接触 DeepSeek API Key。
- `/api/config` 只返回模型名与是否可用，并签发 HttpOnly、Secure、SameSite=Strict 的短期演示会话；不返回密钥。
- 模型接口验证会话签名、同源请求、输入内容和模型输出；没有有效会话的直接请求被拒绝。
- 单会话 30 分钟内最多 20 次模型调用，另有地址、并发和 Worker 实例窗口限制；超限时仍可切换离线模式操作 BOM。
- 这些是内存中的轻量演示限制，实例重启或扩容会重置，不是全局硬性账单上限。长期公开使用时应同时在模型账户设置适当的额度控制。
- 静态资源使用白名单，不提供 `.env`、服务端源文件或运行环境读取接口；未知错误仅返回通用错误文案。

公开版只发送本次输入、近期对话、已确认参数和 BOM 校验摘要给 DeepSeek。请使用仓库的构造样例，不上传企业内部资料。草稿只保存在当前浏览器，人工协助仍为本地交接单。
