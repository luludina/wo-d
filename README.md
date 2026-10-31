# 鸡蛋预约小程序

面向办公室日常蒸蛋场景的微信小程序。同事可以按日期预约鸡蛋，管理员可以维护供餐日、审核成员、查看每日需求，并根据每周账单汇总发起群收款。

## 主要功能

### 普通成员

- 查看今日预约状态和通知
- 在月历中提交单日预约，支持按周、按月批量填充
- 区分未填写、明确预约 0 个和有效预约
- 查看指定日期的已上报与未上报成员
- 查看本周、本月和年度吃蛋排行榜
- 查看个人历史周账单
- 申请调整本人某日实际吃蛋数量，查看审批结果

### 管理员

- 查看今日和明日需要蒸的鸡蛋数量
- 审核、停用和重新启用成员
- 按单日开放、关闭供餐
- 查看周账单汇总及实名成员明细，手动生成、调整和推送成员账单
- 直接调整成员某日实际数量，审核数量调整申请并保留审批历史
- 复制群收款清单，辅助在微信群中手动发起收款

## 业务规则

- 每位成员每天最多预约 5 个鸡蛋
- 工作日默认开放，周末默认关闭，管理员设置优先
- 供餐日当天 09:00 截止修改预约
- 管理员可选择任意日期开放或关闭供餐；关闭会取消该日已有预约，重新开放后不会自动恢复
- 周账单根据已生成时的有效预约固化，单价为 1 元/个
- 周账单由管理员手动生成，不自动生成或补偿；生成后需管理员点击推送，成员才会收到个人账单和站内通知
- 本周存在待审批的实际数量申请时，不允许生成账单
- 保留预约数量与实际数量；未调整时实际数量默认为预约数量，账单使用实际数量
- 截止后、账单生成前，成员可申请补记或调整为 0～5 个，管理员可直接调整或审批；原因选填
- 账单生成后不再允许每日数量调整，并隐藏对应操作入口；审批历史继续保留
- 管理员可调整账单的最终鸡蛋数量，系统保留原始数量、调整原因和操作日志，并通知对应成员

## 技术栈

- 小程序：微信原生小程序 + TypeScript
- API：Node.js 22 + Fastify + TypeScript
- 数据库：MongoDB 8（Replica Set）
- 数据契约：独立 TypeScript workspace package
- 部署：Docker Compose + Nginx + HTTPS
- 包管理：pnpm workspace

## 项目结构

```text
apps/
  api/                 Fastify API、账单与审批服务、集成测试
  miniprogram/         微信原生小程序
packages/
  contracts/           前后端共享类型
deploy/                Docker Compose、Dockerfile 和 Nginx 配置
docs/                  开发说明
outputs/               产品设计、技术设计、实施计划和原型
tests/miniprogram/     小程序公共逻辑测试
```

## 本地开发

### 环境要求

- Node.js 22+
- pnpm 10+
- Docker 与 Docker Compose
- 微信开发者工具
- 已创建的微信小程序 AppID 与 AppSecret

### 1. 安装依赖

```bash
corepack enable
pnpm install
```

### 2. 启动 MongoDB

```bash
docker compose -f deploy/docker-compose.local.yml up -d
```

本地 MongoDB 通过 `localhost:27018` 提供服务。

### 3. 配置并启动 API

```bash
cp apps/api/.env.example apps/api/.env
```

编辑 `apps/api/.env`，至少填写：

```dotenv
SESSION_SECRET=使用 openssl rand -hex 32 生成的随机值
WECHAT_APP_ID=微信小程序 AppID
WECHAT_APP_SECRET=微信小程序 AppSecret
```

启动 API：

```bash
pnpm dev:api
```

可用地址：

- 健康检查：`http://127.0.0.1:3210/health/ready`
- API 文档：`http://127.0.0.1:3210/docs`

### 4. 启动小程序

在微信开发者工具中导入 `apps/miniprogram` 目录并编译。

请求地址会根据微信运行环境自动选择：

- 开发者工具：`http://127.0.0.1:3210`
- 体验版和正式版：`https://egg.zzlulu.cloud`

`project.private.config.json` 是开发者工具的本地私有配置，不会提交到 GitHub。

## 验证

```bash
pnpm typecheck
pnpm build
pnpm test
```

MongoDB 集成测试：

```bash
MONGO_TEST_URI='mongodb://localhost:27018/?replicaSet=rs0&directConnection=true' \
  pnpm --filter @egg-booking/api test:integration
```

## 生产部署

生产环境使用 `deploy/docker-compose.production.yml`。在生产服务器项目目录中创建生产配置：

```bash
cp deploy/.env.production.example deploy/.env.production
```

填写真实密钥后执行：

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.production.yml up -d --build api
```

生产 API 仅绑定宿主机 `127.0.0.1:8090`，由 Nginx 提供公网 HTTPS。MongoDB 仅位于 Docker 内部网络，数据保存在命名卷中。

## 安全说明

- 不要提交 `apps/api/.env` 或 `deploy/.env.production`
- 不要提交微信 AppSecret、会话密钥、生产数据库或用户头像数据
- 微信 AppID 会出现在小程序工程配置中，它不是 AppSecret
- 生产部署前应检查合法域名、HTTPS 证书和微信公众平台的服务器域名配置

更多细节见 [本地开发说明](docs/development.md) 和 [产品设计文档](outputs/鸡蛋预约小程序-产品设计文档.md)。

## 仓库

项目地址：[luludina/wo-d](https://github.com/luludina/wo-d)。

更新后台不会自动发布微信小程序，前端需在微信开发者工具中单独上传、审核和发布。生产更新时保留服务器上的环境变量文件、数据库卷和头像目录。
