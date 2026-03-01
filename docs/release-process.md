# Release Process

This repository uses GitHub PRs, Git tags, and npm publishing.

## 1) Merge PR to `main`

- Ensure CI/build checks pass.
- Merge the release PR into `main`.

## 2) Sync local `main`

```bash
git checkout main
git pull origin main
```

## 3) Create and push release tag

Use an annotated tag for the release commit:

```bash
git tag -a v1.0.3 -m "Release v1.0.3"
git push origin v1.0.3
```

## 4) Create GitHub release from the tag

Use prepared notes from `docs/release-notes-v1.0.3.md`:

```bash
gh release create v1.0.3 \
  --title "v1.0.3" \
  --notes-file docs/release-notes-v1.0.3.md
```

## 5) Publish to npm

```bash
npm whoami
npm run prepublishOnly
npm publish
```

If npm asks for 2FA OTP:

```bash
npm publish --otp <CODE>
```

## 6) Post-release verification

- Verify npm package:

```bash
npm view opencode-omniroute-auth version
```

- Verify GitHub release exists:

```bash
gh release view v1.0.3
```

- Verify OpenCode plugin installation path resolves latest package on clean session.
