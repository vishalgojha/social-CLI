# Social Flow: Setup & Publishing Guide

> Maintainer fast path: `npm run release:patch` (or `release:minor` / `release:major`).

## Project Overview

**meta-cli** is a command-line tool for Meta's APIs (Facebook, Instagram, WhatsApp), built by Chaos Craft Labs. It is designed to make Meta Graph API workflows faster and easier to automate.

### Key Features:
- ✅ Token management for all three APIs
- ✅ Quick API queries without writing scripts  
- ✅ Rate limit monitoring
- ✅ App configuration management
- ✅ Beautiful, colorized output
- ✅ Helpful error messages

---

## For Local Development

### 1. Prerequisites
- Node.js 25+ installed
- npm (comes with Node.js)

### 2. Setup

```bash
# Navigate to project directory
cd meta-cli

# Install dependencies
npm install

# Link for local development (makes 'meta' command available globally)
npm link

# Test it works
meta --help
```

### 3. Testing Locally

```bash
# Try the CLI
meta --help
meta auth status

# Make changes to code, then test immediately
# (npm link creates a symlink, so changes are instant)
```

### 4. Debugging

```bash
# Run with node directly
node bin/meta.js --help

# Use console.log() for debugging
# Or use Node debugger
node --inspect bin/meta.js query me
```

---

## Publishing to npm

### 1. Prepare for Publishing

```bash
# Make sure you're in the project directory
cd meta-cli

# Update version in package.json
# Follow semantic versioning: MAJOR.MINOR.PATCH
npm version patch  # For bug fixes (0.1.0 → 0.1.1)
npm version minor  # For new features (0.1.1 → 0.2.0)
npm version major  # For breaking changes (0.2.0 → 1.0.0)
```

### 2. Create npm Account

If you don't have an npm account:

```bash
# Go to https://www.npmjs.com/signup
# Create an account

# Login via CLI
npm login
# Enter username, password, and email
```

### 3. Publish

```bash
# Dry run first (see what would be published)
npm publish --dry-run

# Actually publish
npm publish

# For first publish of a scoped package (if using @username/meta-cli)
npm publish --access public
```

### 4. Verify

```bash
# Check it's live
npm view meta-cli

# Install globally to test
npm install -g meta-cli

# Test it works
meta --help
```

---

## Before Publishing Checklist

### Required:
- [ ] Package name is available on npm (`npm search meta-cli`)
- [ ] Version number updated in package.json
- [ ] README.md is complete and accurate
- [ ] All dependencies are listed in package.json
- [ ] .gitignore excludes node_modules
- [ ] LICENSE file exists
- [ ] All commands tested locally

### Recommended:
- [ ] CHANGELOG.md created (for version history)
- [ ] GitHub repository set up
- [ ] Repository URL added to package.json
- [ ] Examples work as documented
- [ ] Error handling tested
- [ ] Code linted/formatted

### Nice to Have:
- [ ] Tests written
- [ ] CI/CD set up
- [ ] Badge added to README (version, downloads, etc.)
- [ ] Contributing guide complete
- [ ] Issues/PR templates created

---

## Updating After Publishing

### For Bug Fixes

```bash
# Fix the bug
git add .
git commit -m "Fix: description of bug fix"

# Bump patch version
npm version patch

# Publish
npm publish

# Push to git
git push origin main --tags
```

### For New Features

```bash
# Add feature
git add .
git commit -m "Add: new feature description"

# Bump minor version
npm version minor

# Publish
npm publish

# Push to git
git push origin main --tags
```

---

## Marketing & Distribution

### 1. Create GitHub Repository

```bash
# Initialize git (if not done)
git init
git add .
git commit -m "Initial commit"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOURUSERNAME/meta-cli.git
git branch -M main
git push -u origin main
```

### 2. Add Repository to package.json

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOURUSERNAME/meta-cli.git"
  },
  "bugs": {
    "url": "https://github.com/YOURUSERNAME/meta-cli/issues"
  },
  "homepage": "https://github.com/YOURUSERNAME/meta-cli#readme"
}
```

### 3. Add Badges to README

```markdown
[![npm version](https://badge.fury.io/js/meta-cli.svg)](https://www.npmjs.com/package/meta-cli)
[![Downloads](https://img.shields.io/npm/dm/meta-cli.svg)](https://www.npmjs.com/package/meta-cli)
[![License](https://img.shields.io/npm/l/meta-cli.svg)](LICENSE)
```

### 4. Share It

- Post on Twitter/X with #nodejs #cli #meta #facebook
- Share on Reddit: r/node, r/javascript
- Post on dev.to or Medium
- Add to awesome lists on GitHub
- Share in Meta developer communities

### 5. Keywords for Discovery

In package.json, make sure you have good keywords:

```json
{
  "keywords": [
    "meta",
    "facebook",
    "instagram",
    "whatsapp",
    "graph-api",
    "cli",
    "developer-tools",
    "api-client",
    "social-media"
  ]
}
```

---

## Monetization Options (If You Want)

### Option 1: Freemium Model

Keep the CLI free, but offer:
- Premium support via sponsorship
- Enterprise features (SSO, audit logs, team management)
- Hosted dashboard/analytics service

### Option 2: Open Core

- Core CLI is free and open source (MIT license)
- Paid plugins for advanced features
- Commercial license for enterprise use

### Option 3: GitHub Sponsors

- Keep everything free
- Add sponsor button to README
- Offer sponsor perks (priority support, feature requests)

---

## Maintenance

### Regular Tasks

1. **Monitor Issues/PRs** - Respond to community feedback
2. **Update Dependencies** - Monthly security updates
3. **Test New Meta API Versions** - When Meta updates their API
4. **Update Documentation** - Keep examples current
5. **Release Notes** - Maintain CHANGELOG.md

### Handling Meta API Changes

When Meta updates their Graph API:

```bash
# Update API version in lib/api-client.js
# Change: baseUrls.facebook = 'https://graph.facebook.com/v18.0'
# To:     baseUrls.facebook = 'https://graph.facebook.com/v19.0'

# Test all commands still work
# Update documentation if needed
# Bump version and publish
```

---

## Common Issues & Solutions

### "Package name already taken"

- Try variations: `meta-cli-tool`, `metacli`, `@yourusername/meta-cli`
- Check availability: `npm search PACKAGE_NAME`

### "Permission denied" when publishing

- Make sure you're logged in: `npm whoami`
- Check you have publish rights
- For scoped packages: `npm publish --access public`

### "Module not found" errors

- Make sure all dependencies are in package.json
- Run `npm install` before publishing
- Check file paths are correct

---

## Success Metrics

Track these to measure impact:

- npm downloads (check on npm website)
- GitHub stars
- Issues opened (shows engagement)
- Community contributions
- Twitter mentions

---

## Next Steps

1. **Test everything locally** with `npm link`
2. **Create GitHub repository** and push code
3. **Publish to npm** with `npm publish`
4. **Share with community** on social media
5. **Iterate based on feedback**

Good luck with your CLI! 🚀

---

**Remember:** The best marketing is building something people actually want to use. Focus on solving concrete developer workflow problems, and adoption follows.
