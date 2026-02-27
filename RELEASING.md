# Releasing

## One-time setup

- Create npm token with publish access.
- Add `NPM_TOKEN` secret to GitHub Actions.

## Local preflight

```bash
npm ci
npm run release:check
```

## Version + tag

```bash
npm version patch
git push origin main --follow-tags
```

## Publish flow

- Pushing tag `v*` triggers `.github/workflows/release.yml`
- Workflow builds and publishes to npm.

## Manual fallback

```bash
npm publish --access public
```
