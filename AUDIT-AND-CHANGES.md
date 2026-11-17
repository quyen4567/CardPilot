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
