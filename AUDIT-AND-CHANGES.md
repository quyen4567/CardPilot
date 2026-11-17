# Cardimize v11.3.49 Stage 1 — audit and minimal fixes

Source: user-provided v11.3.48 staging ZIP dated October 13, 2026. Live website not modified.

## Changes made
- Corrected two ranking tie-breaks that treated a legitimate $0 minimum spend as infinity, potentially placing approval-only offers last.
- Changed an advanced recommendation label from “Verified” to “Last checked” and added a reminder to recheck issuer terms. Old checks are not proof of current offers.
- Preserved existing local-storage key (`cardpilotData`), card catalog, scripts, rollback, and workflows.

## Audit findings
- Existing audit: 144 cards, 143 active, releaseReady=false, 78 active records with blockers (October 13 snapshot).
- The app already supports least-spend, bonus-efficiency, historical-high and business-only refinement modes, but they depend on data accuracy and profile selection.
- Missing or stale offer terms remain the primary release blocker; this patch does NOT refresh 2026-11-16 offers.
- The current algorithm calculates bonus ROS excluding annual fees, regular spending rewards, and credits; show that distinction to users.
- Business Preferred Rewards Platinum Honors is available as a separate saved relationship; personal status does not substitute for it.
- Offer eligibility and time-window assumptions require real browser scenarios and issuer-term verification.
- No live deployment, cloud accounts, or cloud storage added.

## Testing
- Structural JavaScript syntax checked with `node --check` on the extracted inline script.
- Original npm test cannot run in this environment because `playwright` is not installed; no browser test pass is claimed.
- Historical browser QA from October 13 does not validate this modified build.

## Release decision
BLOCKED. Use as a staging review artifact only. Do not publish or rely on its old offers for applications.

## Next QA cases
1. Business-only + lowest spend with $0, missing, and $3,000 spend records.
2. Business-only + highest ROS; exclude unverified/expired offers.
3. BofA Platinum Honors business vs personal reward calculation.
4. Owned and previously owned cards; distinguish approval from bonus eligibility.
5. Clear search while retaining wallet; export/import and browser reload.
6. IHG spending deadline and calendar-year scheduling (not yet implemented).

## Development QA follow-up — November 16, 2026
- GitHub Actions run 44003309061 passed the original regression suite, catalog validation, and all seven mobile Chromium scenarios for commit 69d0d92.
- Its fresh release audit reports 143 of 143 active cards blocked, with monitoring sources on 93. The October snapshot above is historical; passing structural checks is not offer verification.
- Reproduced and fixed a remaining default-ranking tie-break: equal-value bonuses now place $0 required spend ahead of $3,000, while missing spend remains unknown.
- Added regression coverage for business-only filtering, least-spend and efficiency ranking, unverified-offer exclusion, and separate personal/business BofA tiers.
- Added a mobile browser scenario for restarting a search and reloading without losing the wallet, shortlist, or business banking relationship.
- Synchronized the lockfile package version to 11.3.49 without changing dependencies.
- Local regression tests pass. Local Chromium cannot launch under the workspace's socket restrictions; the updated browser scenario must be validated by GitHub Actions.
- Root app files, main, Pages settings, and publication remain unchanged. No offer data was refreshed by this QA patch.

## Business offer data review — November 16, 2026
- Reviewed all 26 existing Chase, American Express, and Bank of America business records. Scope: current welcome reward, minimum spending, spending deadline, and annual fee. No personal-card records changed.
- Confirmed 11 Chase and 4 BofA records against opened official public sources. Added missing spending deadlines, source URLs, and review dates. These are offers for the specific linked channel, not a claim that no better channel exists.
- Corrected IHG Business to 150,000 spending-qualified points after $4,000 in 3 months, plus a separate 10,000-point employee-card condition. Corrected Southwest Premier Business to 60,000 points after $3,000 in 3 months. Sapphire Reserve Business's $30,000 spending window is 6 months.
- United Business/Club numeric bonuses now represent 90,000 spending-qualified miles. The extra 10,000 employee-card miles and 2,000 PQP remain described separately, avoiding an inflated spending-return calculation.
- Atmos's $95 fee assumes one card: $70 company fee plus $25 per card. Companion fare and anniversary spending conditions are separate from the points valuation.
- Flagged 11 Amex offers for review. Official search indexes and opened pages sometimes disagree or omit welcome terms. Platinum/Gold linked terms show lower offers than indexed personalized maxima; Delta's current headline and comparison table conflict. Expired Marriott/Delta promotions are not relabeled current.
- Preserved prior numeric terms and review observations for unresolved Amex records; set verified=false, with explicit review reasons. Did not reset their verification dates or copy indexed maximums into confirmed bonuses. Added a real-catalog regression verifying these records do not enter the confirmed business recommendation pool.
- Evidence and per-record before/after scope are in staging/business-offer-review.json. Historical highs, earning rates, and eligibility history remain outside this pass.
- Fresh audit: 128 of 143 active cards remain blocked; issuer sources are recorded for 104. Publication remains blocked. Production files, main, Pages settings, and deployment are unchanged.
