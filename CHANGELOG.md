# Changelog

## 0.2.0

- Added Marketing API support: `meta marketing` (ad accounts, campaigns, ad sets, creatives, async insights, status, create-campaign).
- Added Ads throttling retry/backoff in shared API client (handles error codes 17/32).
- Config: added default Marketing ad account id (`defaults.marketingAdAccountId`).

## 0.2.1

- Marketing: `create-adset`, `create-creative`, `create-ad`, `upload-image`.
- Marketing: `insights --export` to CSV/JSON.

## 0.2.2

- Marketing: `set-status`, `pause`, `resume` for campaigns/ad sets/ads.
- Marketing: `set-budget` for campaigns/ad sets.

## 0.2.3

- Marketing: updated create flows to support object-id-based ops:
  - `create-adset <campaignId>` (auto-resolves ad account)
  - `create-ad <adsetId>` (auto-resolves ad account)
- Marketing: `create-creative` supports `--image-url` and `--video-url` (auto-upload) plus `--body-text/--headline`.
- Marketing: `insights --export ... --append` for CSV/JSON.

## 0.2.4

- Multi-account profiles: `meta accounts ...` and global `--profile <name>`.
- Batch runner: `meta batch run jobs.(json|csv)` using registered tools.

## 0.2.5

- Added test harness (`node test/run.js`) with coverage of config profiles, API redaction/retry, insights export append, and batch BOM handling.
- Added GitHub Actions CI workflow to run tests on Node 18/20/22.
- Packaging: `files` whitelist for safer npm publishes.
