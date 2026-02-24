# Deployment

This repo is configured for Railway via [railway.json](./railway.json):

- Build: `npm run build`
- Start: `npm start`

## Railway CLI (Shell)

Run from repo root:

```bash
railway up
```

## First-Time Setup

```bash
npm i -g @railway/cli
railway login
railway link
railway up
```

## Deploy Specific Service/Environment

```bash
railway up --service <service-name> --environment <environment-name>
```

## Quick Verify

After deploy, verify the service binds Railway `PORT` and is healthy:

```bash
railway logs
```

Look for a line like:

`Social API Gateway is running.`

and then hit:

`/api/health`

## Rollback (One Command)

If latest deploy is bad, revert commit, push, and redeploy:

```bash
git revert --no-edit <bad_commit_sha> && git push origin main && railway up
```

Replace `<bad_commit_sha>` with the commit to undo.
