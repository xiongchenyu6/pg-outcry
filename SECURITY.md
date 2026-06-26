# Security Policy / 安全策略

## Status / 项目状态

pg-outcry is **open-source reference software**. The core flows (matching, double-entry
settlement, reservations, RLS isolation, reconciliation, wallet approvals) are covered by an
automated end-to-end test suite and a reconciliation invariant check. **It has not undergone an
independent third-party security or financial audit.** Do not custody real user funds on it
without your own audit, hardening, and legal/compliance review.

pg-outcry 是**开源参考实现**。核心流程（撮合、双边记账结算、冻结、RLS 隔离、对账、钱包审批）有自动化端到端
测试与对账不变量校验覆盖，但**未经独立第三方安全或财务审计**。在未经你自己的审计、加固与合规审查前，请勿用于
托管真实用户资金。

## Reporting a vulnerability / 漏洞报告

Please report security issues **privately** — do not open a public issue.
请**私下**报告安全问题，勿公开 issue。

- Use GitHub **Security Advisories** ("Report a vulnerability") on this repo, or
- email the maintainer (see the GitHub profile).

We aim to acknowledge within a few days. Please include reproduction steps and impact.
我们会在数日内回复。请附复现步骤与影响说明。

## Hardening checklist for operators / 运营加固清单

If you deploy this, at minimum:
- Keep the `service_role` key server-side only; never ship it to browsers. The back-office
  console is an **operator tool** — run it on a trusted, access-controlled machine.
- Front the API with TLS, rate limiting, and WAF; enable Supabase Auth MFA for operators.
- Review and tighten every RLS policy and the `9900_lockdown` function whitelist for your schema.
- Configure real OAuth providers + email; disable open signups if you require KYC-first onboarding.
- Set per-role `statement_timeout`, connection limits, backups/PITR, and monitoring.
- Wire withdrawals to real custody only behind manual/multi-party approval; keep the audit log immutable.
