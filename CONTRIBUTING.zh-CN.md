[English](./CONTRIBUTING.md) · **中文**

# 贡献指南

感谢你的关注！

## 开发环境搭建
```bash
supabase start && supabase db reset
export ANON="$(supabase status -o json | jq -r .ANON_KEY)"
export SERVICE="$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)"
```

## 提交 PR 之前
- 运行冒烟测试套件（必须保持全部通过——CI 会运行相同的测试）：
  `scripts/smoke-postgrest.sh` 和 `scripts/smoke-stage{2,3,4,5,7,8,9}.sh`（需导出 `ANON`/`SERVICE`）。
- 如果你改动了 WASM 引擎：执行 `cd web && npm run build:wasm` 并提交 `web/public/orderbook.wasm`。
- 尽可能保持迁移是增量式且幂等的；特权操作在托管的 Supabase 上应当自动跳过
  （用尽力而为的 `DO` 块包裹）。新增的引擎函数必须被 `9900_lockdown` 覆盖。
- 使用规范、描述清晰的提交信息。

## 许可
本项目采用 **AGPL-3.0**（其匹配的核心代码衍生自
[tolyo/open-outcry](https://github.com/tolyo/open-outcry)，AGPL-3.0）。提交贡献即表示你同意
你的贡献以 AGPL-3.0 授权。

## 安全
请勿为漏洞提交公开 issue——参见 [SECURITY.md](./SECURITY.zh-CN.md)。
