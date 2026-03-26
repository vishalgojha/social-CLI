# Ads Intelligence Phase A Spec

## Goal
Build the first real `Ads Intelligence` slice for Social Flow as a read-only operator workflow.

Phase A should answer:
1. What is happening in the ad account right now?
2. Which campaigns are likely winners, bleeders, or fatigue risks?
3. What should the operator look at next?

This phase must be:
1. Read-only
2. Safe by default
3. Useful in both Control UI and AI chat
4. Small enough to ship in one focused implementation phase

---

## Product Scope

### In Scope
1. Account-level summary
2. Campaign/ad-set level health scoring
3. Simple trend and pacing snapshots
4. Heuristic labels:
   - `winner`
   - `watch`
   - `bleeder`
   - `fatigue_risk`
5. Plain-English recommendation output
6. Read-only UI cards and chat summaries

### Out of Scope
1. Budget mutations
2. Creative upload
3. Ad creation or publish
4. Pixel/CAPI audit
5. Auto-optimization
6. Long historical warehousing

---

## User Stories

1. As an operator, I can open Control UI and immediately see whether my ads account needs attention.
2. As an operator, I can see which campaigns deserve more budget review and which are likely wasting money.
3. As an operator, I can ask the AI chat:
   - `How are my ads doing?`
   - `Show winners and bleeders`
   - `Which campaigns look fatigued?`
4. As an operator, I get reasons, not just labels.

---

## Data Model

Phase A should normalize ad account data into a compact internal snapshot.

### Entity: `AdsAccountSnapshot`
```json
{
  "accountId": "act_123",
  "currency": "INR",
  "timezone": "Asia/Kolkata",
  "capturedAt": "2026-03-25T10:00:00.000Z",
  "range": "last_7d",
  "totals": {
    "spend": 12450.22,
    "impressions": 240000,
    "clicks": 5400,
    "ctr": 2.25,
    "cpc": 2.31,
    "conversions": 73,
    "cpa": 170.55,
    "frequency": 1.84
  },
  "campaigns": []
}
```

### Entity: `AdsCampaignSnapshot`
```json
{
  "campaignId": "120001",
  "campaignName": "March Lead Gen - Mumbai",
  "status": "ACTIVE",
  "objective": "LEADS",
  "spend": 4200.12,
  "impressions": 85000,
  "clicks": 1900,
  "ctr": 2.23,
  "cpc": 2.21,
  "conversions": 31,
  "cpa": 135.49,
  "frequency": 2.42,
  "trend": {
    "ctrDeltaPct": -18.2,
    "cpcDeltaPct": 12.8,
    "cpaDeltaPct": 16.4,
    "frequencyDeltaPct": 22.1
  },
  "labels": ["fatigue_risk", "watch"],
  "score": 58,
  "reasonCodes": ["ctr_down", "cpc_up", "frequency_rising"],
  "recommendation": {
    "priority": "medium",
    "title": "Refresh creative soon",
    "summary": "CTR is falling while frequency is rising.",
    "nextAction": "Review creative fatigue and compare recent variants."
  }
}
```

---

## Heuristics

Phase A should use simple deterministic rules first. No opaque ML layer.

### Winner
Mark `winner` when:
1. Spend is above minimum threshold
2. CTR is healthy for the account
3. CPA is below account median or below target
4. CPC is stable or improving

Suggested initial logic:
1. Require minimum spend:
   - `spend >= configurableMinSpend`
2. Require meaningful activity:
   - `clicks >= configurableMinClicks`
3. Winner if:
   - `ctr >= accountMedianCtr`
   - `cpa <= accountMedianCpa`
   - `cpc <= accountMedianCpc * 1.1`

### Bleeder
Mark `bleeder` when:
1. Spend is meaningful
2. CPA is materially worse than account median or target
3. CTR is weak or CPC is inflated

Suggested initial logic:
1. `spend >= configurableMinSpend`
2. `cpa >= accountMedianCpa * 1.35` OR conversions are zero after meaningful spend
3. plus one of:
   - `ctr < accountMedianCtr * 0.7`
   - `cpc > accountMedianCpc * 1.35`

### Fatigue Risk
Mark `fatigue_risk` when:
1. Frequency is rising
2. CTR is falling
3. CPC or CPA is worsening

Suggested initial logic:
1. `frequency >= configurableFatigueFrequency`
2. `trend.ctrDeltaPct <= -15`
3. and either:
   - `trend.cpcDeltaPct >= 10`
   - `trend.cpaDeltaPct >= 10`

### Watch
Mark `watch` when:
1. There is enough spend to observe
2. It is not strong enough to be a winner
3. It is not clearly bad enough to be a bleeder

---

## Config Defaults

These should live in a small deterministic config object.

```json
{
  "adsIntelligence": {
    "minSpend": 1000,
    "minClicks": 25,
    "fatigueFrequency": 2.2,
    "defaultRange": "last_7d",
    "currencyFallback": "INR"
  }
}
```

Later these can become workspace/account overrides.

---

## API Design

All endpoints should live behind the existing gateway key.

### 1. `GET /api/ads/overview`
Purpose:
Return account summary plus top recommendations for the selected range.

Query params:
1. `accountId` optional
2. `range` optional
   - `today`
   - `yesterday`
   - `last_3d`
   - `last_7d`
   - `last_14d`

Response:
```json
{
  "ok": true,
  "capturedAt": "2026-03-25T10:00:00.000Z",
  "account": {
    "accountId": "act_123",
    "currency": "INR",
    "timezone": "Asia/Kolkata"
  },
  "summary": {
    "spend": 12450.22,
    "ctr": 2.25,
    "cpc": 2.31,
    "cpa": 170.55,
    "conversions": 73,
    "activeCampaigns": 8
  },
  "segments": {
    "winners": 2,
    "watch": 3,
    "bleeders": 2,
    "fatigueRisk": 1
  },
  "recommendations": [
    {
      "priority": "high",
      "type": "bleeder_review",
      "targetId": "120001",
      "title": "Review Mumbai Retargeting",
      "summary": "CPA is 42% above account median.",
      "nextAction": "Inspect audience overlap and creative fatigue."
    }
  ]
}
```

### 2. `GET /api/ads/campaigns`
Purpose:
Return normalized campaign rows with labels and recommendation data.

Query params:
1. `accountId` optional
2. `range` optional
3. `label` optional
   - `winner`
   - `watch`
   - `bleeder`
   - `fatigue_risk`

Response:
```json
{
  "ok": true,
  "items": [AdsCampaignSnapshot],
  "count": 8,
  "capturedAt": "2026-03-25T10:00:00.000Z"
}
```

### 3. `GET /api/ads/briefing`
Purpose:
Return a human-readable summary optimized for chat and dashboard highlights.

Response:
```json
{
  "ok": true,
  "headline": "2 winners, 2 bleeders, 1 fatigue risk across 8 active campaigns.",
  "highlights": [
    "March Lead Gen - Pune is outperforming on CPA.",
    "Mumbai Retargeting is overspending with weak CTR.",
    "Creative fatigue risk detected in Video Funnel 03."
  ],
  "nextActions": [
    "Review the top 2 bleeders first.",
    "Check fatigue on Video Funnel 03.",
    "Prepare a creative refresh for Mumbai Retargeting."
  ]
}
```

### 4. Optional Later: `GET /api/ads/account/options`
Purpose:
Return discovered ad accounts to populate a selector.

Not required for Phase A if only one account is in play.

---

## Backend Shape

### Suggested Internal Modules
1. `lib/ads/meta-fetch.ts`
   - Graph API fetches
   - raw campaign/account insights retrieval
2. `lib/ads/normalize.ts`
   - normalize raw API data into Social Flow snapshot shape
3. `lib/ads/heuristics.ts`
   - winner/bleeder/fatigue/watch logic
4. `lib/ads/briefing.ts`
   - human-readable summary builder
5. `lib/ads/types.ts`
   - shared shapes

### Gateway Integration
Add routes in the gateway:
1. `GET /api/ads/overview`
2. `GET /api/ads/campaigns`
3. `GET /api/ads/briefing`

These should:
1. validate gateway auth
2. resolve active account/workspace
3. fetch Graph data
4. normalize data
5. return deterministic JSON

### Failure Modes
Return structured errors:
1. `missing_ads_account`
2. `missing_token`
3. `meta_api_error`
4. `insufficient_permissions`
5. `empty_data`

Do not silently fall back to fake rows.

---

## Control UI Spec

### New Surface: `Ads Overview`
Add a first-class nav item in Control UI.

#### Top Cards
1. Spend
2. CTR
3. CPA
4. Active campaigns
5. Winners / bleeders / fatigue counts

#### Main Panels
1. `Needs Attention`
   - top recommendations sorted high -> low
2. `Campaign Health`
   - table or cards with:
     - name
     - spend
     - CTR
     - CPC
     - CPA
     - frequency
     - labels
3. `Briefing`
   - short human-readable summary

#### Interaction Rules
1. No write buttons in Phase A
2. Clicking a campaign opens a detail drawer or detail card
3. Filters:
   - all
   - winners
   - bleeders
   - fatigue risk

#### Empty State
If no ads data:
1. say exactly why
2. show the next fix
3. do not render fake data

Example:
`No ads data yet. Connect a Meta ads account or confirm the default ad account ID.`

---

## AI Chat Spec

The chat layer should be able to summarize Ads Intelligence using the same backend data.

### Supported Early Prompts
1. `How are my ads doing?`
2. `Show my winners and bleeders`
3. `Which campaigns look fatigued?`
4. `Give me a 7-day ads briefing`

### Chat Behavior
1. The chat agent should call the ads briefing/overview endpoints or equivalent internal functions.
2. Response should include:
   - one-line summary
   - winners
   - bleeders
   - fatigue risks
   - suggested next actions

### Chat Output Style
Keep it operator-friendly:
1. short headline
2. bullet highlights
3. next steps

---

## UX Rules

1. Never show fake ad campaigns in production mode.
2. Always explain why a label was assigned.
3. Make “winner” and “bleeder” thresholds feel stable and auditable.
4. Use plain language over marketing jargon where possible.
5. Every recommendation should answer:
   - why this matters
   - what to inspect next

---

## Observability

Add logs for:
1. ads fetch start/end
2. account/range selected
3. number of campaigns processed
4. heuristic labels assigned counts
5. meta API failures

Suggested event names:
1. `ads.fetch.started`
2. `ads.fetch.succeeded`
3. `ads.fetch.failed`
4. `ads.heuristics.scored`
5. `ads.briefing.generated`

---

## Security

1. Never return raw access tokens in API responses.
2. Never log token values.
3. Treat ad account IDs as non-secret but still scoped data.
4. Keep all ads endpoints behind `x-gateway-key`.
5. Do not expose account mutation endpoints in Phase A.

---

## Testing Plan

### Backend Tests
1. Empty account data returns `empty_data`
2. Winner heuristic labels strong campaign correctly
3. Bleeder heuristic labels weak high-spend campaign correctly
4. Fatigue risk triggers on rising frequency + falling CTR
5. Overview endpoint aggregates counts correctly
6. Briefing endpoint returns deterministic headline + highlights

### UI Tests
1. Ads Overview renders live summary cards from API
2. Filter chips narrow campaigns by label
3. Empty state renders backend reason
4. Recommendation panel orders high priority first

### Chat Tests
1. Ads prompts route to briefing behavior
2. Response includes headline + highlights + next actions

---

## Definition of Done

Phase A is done when:
1. Control UI has a real `Ads Overview` screen
2. AI chat can answer basic ads health prompts
3. No fake ads rows are used in production
4. Winner/bleeder/fatigue labels are deterministic and tested
5. Every response includes readable next actions

---

## Suggested Next Build Order

1. Add backend types + normalize layer
2. Add heuristics module
3. Add `GET /api/ads/overview`
4. Add `GET /api/ads/campaigns`
5. Add `GET /api/ads/briefing`
6. Add Control UI `Ads Overview`
7. Add chat routing for ads prompts
