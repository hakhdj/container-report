# container-report Cloudflare trigger

Cloudflare Worker 每 2 分钟查询腾讯文档的 `last_modify_time`，与仓库中的
`.last_modify` 比较。只有时间戳变化时才发送 `repository_dispatch`，完整数据仍由
GitHub Actions 拉取和更新。

## Secrets

```text
GITHUB_TOKEN
TENCENT_DOCS_TOKEN
TENCENT_SMARTSHEET_FILE_ID
```

当前腾讯文档文件 ID：

```text
AfwOngxVyPfC
```

## Commands

```powershell
npm install
npm test
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TENCENT_DOCS_TOKEN
npx wrangler secret put TENCENT_SMARTSHEET_FILE_ID
npx wrangler deploy
```

Cron 已在 `wrangler.jsonc` 中配置为：

```text
*/2 * * * *
```
