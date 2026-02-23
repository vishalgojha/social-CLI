# Quick Start Guide

Get up and running with social-cli in 5 minutes.

## Step 1: Install

```bash
npm install -g @vishalgojha/social-cli
```

Windows one-click (from repo source):

```powershell
.\install.cmd
```

Or use it without installing:
```bash
npx @vishalgojha/social-cli
```

## Step 2: Get Your Access Token

### For Facebook/Instagram:

1. Visit [Meta for Developers](https://developers.facebook.com/)
2. Go to **My Apps** → Select your app (or create one)
3. Navigate to **Tools** → **Graph API Explorer**
4. Click **Generate Access Token**
5. Select permissions you need (e.g., `pages_read_engagement`, `instagram_basic`)
6. Copy the token

### For WhatsApp Business:

1. Visit [Meta Business Suite](https://business.facebook.com/)
2. Select your **WhatsApp Business Account**
3. Go to **Settings** → **API Setup**
4. Generate a **Permanent Token**
5. Copy the token

## Step 3: Authenticate

```bash
# Paste your token when prompted
social auth login --api facebook

# Or provide it directly
social auth login --api facebook --token YOUR_TOKEN_HERE
```

## Step 4: Test It Out

```bash
# Get your profile
social query me

# See what it returns
social query me --fields id,name,email
```

## Step 5: Explore

```bash
# Get your Facebook pages
social query pages

# Get Instagram media
social query instagram-media --limit 10

# Check rate limits
social limits check

# See all commands
social --help
```

## Common First Commands

### See your authentication status
```bash
social auth status
```

### Get app information
```bash
social app info
```

### Make a custom query
```bash
social query custom /me/photos --fields id,name,created_time
```

### Check if you're hitting rate limits
```bash
social limits check
```

## Pro Tips

### 1. Use JSON output for scripting
```bash
social query me --json | jq .name
```

### 2. Store multiple API tokens
```bash
social auth login --api facebook
social auth login --api instagram
social auth login --api whatsapp
```

### 3. Set up app credentials for advanced features
```bash
social auth app
# Enter your App ID and Secret when prompted
```

### 4. Save your tokens securely
social-cli stores tokens in your system's config directory:
- macOS: `~/Library/Preferences/social-cli/`
- Linux: `~/.config/social-cli/`
- Windows: `%APPDATA%\social-cli\`

### 5. Use aliases for common commands
```bash
# Add to ~/.bashrc or ~/.zshrc
alias mq='social query'
alias ml='social limits check'
alias ma='social auth status'
```

## Troubleshooting

### "No token found"
→ Run `social auth login --api YOUR_API`

### "Token validation failed"
→ Your token might be expired. Generate a new one from Meta for Developers.

### "Rate limit exceeded"
→ You're making too many requests. Check with `social limits check` and wait.

### "Command not found: social"
→ Install globally: `npm install -g @vishalgojha/social-cli`

## Next Steps

- Read the [full README](README.md) for all commands
- Check out [examples](EXAMPLES.md) for real-world usage
- Review [contributing guide](CONTRIBUTING.md) to add features

## Need Help?

- Run `social --help` for command list
- Run `social COMMAND --help` for command-specific help
- Open an issue on GitHub
- Check Meta's [Graph API documentation](https://developers.facebook.com/docs/graph-api/)

---

**You're ready to go!** Start querying Meta's APIs without the headache. 🚀
