# Example Usage Scripts

## Basic Authentication and Query

```bash
#!/bin/bash
# authenticate.sh - Set up authentication

echo "Setting up Social Flow authentication..."

# Prompt for Facebook token
echo "Enter your Facebook access token:"
read -s FB_TOKEN
social auth login --api facebook --token "$FB_TOKEN"

# Prompt for Instagram token
echo "Enter your Instagram access token (or press enter to skip):"
read -s IG_TOKEN
if [ ! -z "$IG_TOKEN" ]; then
  social auth login --api instagram --token "$IG_TOKEN"
fi

# Set up app credentials
echo "Enter your App ID:"
read APP_ID
echo "Enter your App Secret:"
read -s APP_SECRET
social auth app --id "$APP_ID" --secret "$APP_SECRET"

echo "✓ Authentication complete!"
social auth status
```

## Monitoring Rate Limits

```bash
#!/bin/bash
# check-limits.sh - Monitor rate limits before bulk operations

check_and_wait() {
  while true; do
    USAGE=$(social limits check --json 2>/dev/null | jq -r '.usage.call_count // 0')
    
    if [ "$USAGE" -lt 70 ]; then
      echo "✓ Rate limit OK (${USAGE}% used)"
      return 0
    else
      echo "⚠ Rate limit high (${USAGE}% used) - waiting 5 minutes..."
      sleep 300
    fi
  done
}

echo "Checking rate limits before operation..."
check_and_wait

echo "Proceeding with operations..."
# Your bulk operations here
social query pages
social query instagram-media --limit 50
```

## Fetching and Analyzing Instagram Data

```bash
#!/bin/bash
# instagram-report.sh - Generate Instagram engagement report

OUTPUT_FILE="instagram-report-$(date +%Y%m%d).json"

echo "Fetching Instagram data..."

# Get account info
ACCOUNT=$(social query me --api instagram --fields id,username,media_count --json)
echo "$ACCOUNT" > "$OUTPUT_FILE"

# Get recent media
MEDIA=$(social query instagram-media --limit 50 --json)
echo "$MEDIA" >> "$OUTPUT_FILE"

# Extract engagement metrics with jq
echo ""
echo "=== Instagram Report ==="
echo "Account: $(echo $ACCOUNT | jq -r '.username')"
echo "Total Media: $(echo $ACCOUNT | jq -r '.media_count')"
echo ""
echo "Recent Posts:"
echo "$MEDIA" | jq -r '.data[] | "\(.media_type): \(.caption[0:50])..."'

echo ""
echo "Report saved to: $OUTPUT_FILE"
```

## Automated Facebook Page Posting

```bash
#!/bin/bash
# auto-post.sh - Post to Facebook pages with rate limit checking

PAGE_ID="YOUR_PAGE_ID"
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  echo "Usage: ./auto-post.sh 'Your message here'"
  exit 1
fi

# Check rate limits
USAGE=$(social limits check --json 2>/dev/null | jq -r '.usage.call_count // 0')
if [ "$USAGE" -gt 80 ]; then
  echo "⚠ Rate limit too high (${USAGE}%) - try again later"
  exit 1
fi

# Get page access token
PAGE_TOKEN=$(social query pages --json | jq -r ".data[] | select(.id==\"$PAGE_ID\") | .access_token")

if [ -z "$PAGE_TOKEN" ]; then
  echo "✖ Could not find page token for page ID: $PAGE_ID"
  exit 1
fi

# Post to page (you'll need to implement this endpoint)
echo "Posting to page: $PAGE_ID"
social query custom "/$PAGE_ID/feed" \
  --api facebook \
  --params "{\"message\":\"$MESSAGE\",\"access_token\":\"$PAGE_TOKEN\"}"

echo "✓ Posted successfully!"
```

## Token Rotation Script

```bash
#!/bin/bash
# rotate-tokens.sh - Refresh tokens before expiration

DAYS_BEFORE_EXPIRY=7

check_token_expiry() {
  local API=$1
  
  TOKEN_INFO=$(social auth debug --api "$API" --json 2>/dev/null)
  EXPIRES_AT=$(echo "$TOKEN_INFO" | jq -r '.data.expires_at // 0')
  
  if [ "$EXPIRES_AT" -eq 0 ]; then
    echo "Token for $API never expires"
    return 0
  fi
  
  CURRENT_TIME=$(date +%s)
  DAYS_LEFT=$(( ($EXPIRES_AT - $CURRENT_TIME) / 86400 ))
  
  if [ "$DAYS_LEFT" -lt "$DAYS_BEFORE_EXPIRY" ]; then
    echo "⚠ Token for $API expires in $DAYS_LEFT days!"
    return 1
  else
    echo "✓ Token for $API valid for $DAYS_LEFT days"
    return 0
  fi
}

echo "Checking token expiration..."

for API in facebook instagram whatsapp; do
  if ! check_token_expiry "$API"; then
    echo "Please refresh your $API token"
    echo "Run: social auth login --api $API"
  fi
done
```

## Cron Job for Monitoring

```bash
# Add to crontab: crontab -e
# Check rate limits every hour and log
0 * * * * /path/to/social limits check --json >> /var/log/social-flow-limits.log 2>&1

# Daily Instagram stats backup
0 2 * * * /path/to/scripts/instagram-report.sh >> /var/log/instagram-backup.log 2>&1
```

## Node.js Integration

```javascript
// Using Social Flow from Node.js via child_process
const { execSync } = require('child_process');

function getInstagramMedia(limit = 10) {
  try {
    const output = execSync(`social query instagram-media --limit ${limit} --json`, {
      encoding: 'utf8'
    });
    return JSON.parse(output);
  } catch (error) {
    console.error('Failed to fetch Instagram media:', error.message);
    return null;
  }
}

function checkRateLimits() {
  try {
    const output = execSync('social limits check --json', { encoding: 'utf8' });
    const limits = JSON.parse(output);
    return limits.usage?.call_count || 0;
  } catch (error) {
    return 100; // Assume maxed out on error
  }
}

async function safeApiCall(command) {
  const usage = checkRateLimits();
  
  if (usage > 75) {
    console.log(`Rate limit high (${usage}%), waiting...`);
    await new Promise(resolve => setTimeout(resolve, 300000)); // Wait 5 min
  }
  
  return execSync(command, { encoding: 'utf8' });
}

// Example usage
(async () => {
  const media = getInstagramMedia(20);
  console.log(`Found ${media.data.length} posts`);
  
  for (const post of media.data) {
    console.log(`${post.media_type}: ${post.caption?.substring(0, 50)}...`);
  }
})();
```

## Testing Script

```bash
#!/bin/bash
# test-setup.sh - Verify Social Flow installation and configuration

echo "Testing Social Flow setup..."
echo ""

# Check installation
if ! command -v social &> /dev/null; then
  echo "✖ social not found. Install with: npm install -g @vishalgojha/social-flow"
  exit 1
fi
echo "✓ social is installed"

# Check authentication
if social auth status 2>&1 | grep -q "not set"; then
  echo "⚠ Some tokens not configured"
  echo "  Run: social auth login"
else
  echo "✓ Tokens configured"
fi

# Test API connectivity
echo ""
echo "Testing API connectivity..."

if social query me --api facebook 2>&1 | grep -q "id"; then
  echo "✓ Facebook API working"
else
  echo "✖ Facebook API failed"
fi

if social query me --api instagram 2>&1 | grep -q "id"; then
  echo "✓ Instagram API working"
else
  echo "⚠ Instagram API not configured or failed"
fi

echo ""
echo "Setup check complete!"
```

---

These examples demonstrate common use cases. Modify them to fit your specific needs!
