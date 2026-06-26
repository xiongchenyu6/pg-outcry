# Contributing / 贡献指南

Thanks for your interest! / 感谢你的关注！

## Dev setup
```bash
supabase start && supabase db reset
export ANON="$(supabase status -o json | jq -r .ANON_KEY)"
export SERVICE="$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)"
```

## Before opening a PR
- Run the smoke suite (must stay green — CI runs the same):
  `scripts/smoke-postgrest.sh` and `scripts/smoke-stage{2,3,4,5,7,8,9}.sh` (export `ANON`/`SERVICE`).
- If you touch the WASM engine: `cd web && npm run build:wasm` and commit `web/public/orderbook.wasm`.
- Keep migrations additive and idempotent where possible; privileged ops should self-skip on hosted
  Supabase (wrap in best-effort `DO` blocks). New engine functions must be covered by `9900_lockdown`.
- Conventional, descriptive commit messages.

## Licensing
This project is **AGPL-3.0** (the matching core derives from
[tolyo/open-outcry](https://github.com/tolyo/open-outcry), AGPL-3.0). By contributing you agree
your contributions are licensed under AGPL-3.0. / 本项目为 AGPL-3.0；提交即表示你的贡献以 AGPL-3.0 授权。

## Security
Do not file public issues for vulnerabilities — see [SECURITY.md](./SECURITY.md).
