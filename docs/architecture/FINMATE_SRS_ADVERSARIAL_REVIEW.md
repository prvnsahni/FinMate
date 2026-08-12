# FinMate SRS — Adversarial Review Report

> This is the exact adversarial review delivered inline prior to the R1 corrections, saved verbatim for the record. Findings F-01…F-18 below were the basis for the R1 corrections applied to `FINMATE_SRS.md` (see that document's §0 Revision history). Nothing here has been rewritten or re-scoped.

## 1. Executive verdict
The SRS is **structurally sound and traceable, with no hard contradiction against a frozen decision** (no STOP condition). But a **careless, rushed, or literal implementer could still damage FinMate** through: (a) a thin financial-correctness acceptance test that permits an engine rewrite, (b) an auth-transport sequencing conflict that either breaks native clients or leaves SEC-W3 permanently open, (c) a deletion requirement that can be satisfied while leaving the user's own data behind, (d) several Rule-20 loopholes (Class-B key co-location, "controlled enum" free-text leakage, cached-projection consent bypass), and (e) **scope creep — personalization is marked V1 but contradicts Doc #10 (V2) and depends on unbuilt intelligence + DPIA**. None requires changing a frozen decision; all are SRS-clarity/scoping fixes. **Verdict: not ready to freeze — 3 P0/P1-critical and ~9 P1 findings need correction first.**

Per-finding template: **ID · Severity · SRS req(s) · Source · Problem · Failure scenario · Why it matters · Correction · Compat impact · Impl impact · PO? · Counsel?**

## 2. P0 issues

**F-01 · P0 · FIN-002, FIN-007 · #11/Rule 2,20 · Financial-correctness acceptance is too weak and quick-add defaults can alter computed shares.**
- *Problem:* FIN-002 acceptance ("same inputs → same balances as production") names no **test corpus**; a literal implementer could rewrite the calc engine and pass a handful of simple cases while breaking multi-payer/percent-share/refund/household-carry-forward/spectator/multi-currency edge cases. FIN-007 "smart defaults" is unconstrained — defaults could feed the *computed* split/payer, not just pre-fill UI.
- *Failure scenario:* quick-add pre-selects an "equal split among all members" default; user meant a 70/30 split; the persisted split differs → wrong balances, silently, at scale.
- *Why it matters:* financial correctness is the protected core; silent drift is the worst possible failure.
- *Correction:* FIN-002 acceptance MUST require a **golden-fixture parity suite** covering all split types, multi-payer, refunds, household carry-forward, spectator exclusion, and multi-currency, run against current production logic. FIN-007 MUST state defaults are **UI pre-fills the user confirms**, never auto-applied to computed shares without explicit split selection.
- *Compat:* CRITICAL. *Impl:* build parity fixtures before any calc refactor. *PO:* No. *Counsel:* No.

## 3. P1 issues

**F-02 · P1 (conflict) · SEC-003, AUTH-002/004/005 · AU-1/AU-4/SEC-W3 · Auth-transport sequencing conflict — SEC-W3 may never actually close, or native breaks.**
- *Problem:* SEC-003 says "remove refresh token from body," AUTH-005 says "support old clients until min-version enforced." No **sunset policy** is defined; and removing body emission before the **native header path** (AUTH-004) exists breaks the current native app (which uses the body token).
- *Failure scenario:* team ships the web cookie + stops body emission; un-updated mobile users can't refresh → mass logout. Or, to avoid that, body emission is kept "temporarily" forever → SEC-W3/T-02 never closed.
- *Correction:* add an explicit ordering + sunset requirement: body emission removed **only after** both web-cookie and native-header paths ship **and** a min-supported-version is enforced with a **defined sunset date**; SEC-003 is "satisfied" only at sunset.
- *Compat:* HIGH. *Impl:* sequence web+native+min-version together. *PO:* **YES** (sunset date). *Counsel:* No.

**F-03 · P1 (Rule-20 loophole) · DEL-001/002 · DEL-1 · Deletion can be satisfied while leaving the user's own data.**
- *Problem:* DEL-001 acceptance verifies "others' ledgers intact; identity tombstoned" but **not** that the user's own **personal-scope** data (personal expenses, goals, journal) is actually erased.
- *Failure scenario:* implementer scrubs the `users` row PII + tombstones shared records, leaves personal expenses/journal in place → "deletion" that doesn't delete.
- *Correction:* DEL-001 acceptance MUST assert **personal-scope data is erased and personal-domain keys crypto-shredded**, in addition to shared tombstoning.
- *Compat:* n/a (new feature). *Impl:* enumerate personal-scope tables. *PO:* No. *Counsel:* No.

**F-04 · P1 (Rule-20) · AI-002/AI-004 · AI-2/AI-4 · "Controlled enum" can smuggle free-text to AI.**
- *Problem:* AI-004 requires mapping custom categories to a "controlled enum" but never bounds the enum to a **fixed, finite, non-user-derived set**. A literal implementer could relabel raw merchant/category strings as "enum values."
- *Failure scenario:* `enum = "Starbucks_Koramangala"` → free-text merchant reaches OpenAI, violating AI-2/AI-6.
- *Correction:* AI-004 MUST specify a **fixed server-defined enum whitelist**; unmapped custom categories map to `OTHER`, never pass raw text. Acceptance: fuzz test proves no user string reaches egress.
- *Compat:* additive. *Impl:* enum whitelist. *PO:* No. *Counsel:* No.

**F-05 · P1 · AI-005, PRIV-004 · CON-1/AI-5 · Withdrawal doesn't invalidate cached/pending projections.**
- *Problem:* consent gates egress at build time, but nothing requires **invalidating cached projections or in-flight/queued AI requests** on withdrawal.
- *Failure scenario:* user withdraws AI consent; a projection cached seconds earlier is still sent → post-withdrawal egress.
- *Correction:* PRIV-004/AI-005 MUST require withdrawal to invalidate cached projections and cancel pending egress.
- *Compat:* additive. *Impl:* cache invalidation hook. *PO:* No. *Counsel:* No.

**F-06 · P1 (scope) · UX-005 · #10 · Personalization is marked V1 but Doc #10 places it in V2 and it depends on unbuilt architecture.**
- *Problem:* UX-005 ("Helpful→Proactive→**Personalized** progression") is Scope V1C, but Doc #10's feature-priority table classifies the **earned personalization engine as V2**, and the Personalized stage depends on INTELLIGENCE (TARGET) + DPIA (OQ-02) + outbox (TARGET).
- *Failure scenario:* team commits V1 to a feature that legally can't ship until a DPIA, blowing V1 scope/timeline; or ships personalization prematurely without the firewall/intelligence guards.
- *Correction:* split UX-005 — **Helpful = V1**, **Proactive = V1/late-V1**, **Personalized = V2** (gated on INTELLIGENCE + DPIA). Align SRS with Doc #10.
- *Compat:* n/a. *Impl:* de-scope. *PO:* **YES** (confirm V1 boundary). *Counsel:* No (DPIA already flagged).

**F-07 · P1 (dependency/scope) · NOT-001..005 · #11/#12 · V1 notification push depends on unbuilt push infrastructure.**
- *Problem:* NOT-002 ("only L1/L2 **pushed**") and NOT-005 (content-free **push** payloads) are scoped V1C/TARGET, but there is **no notification system today** and native/web **push is TARGET** (mobile is web-wrapped, no push plugin).
- *Failure scenario:* V1 "ranked notifications" can't actually push on mobile; team either delays V1 or ships in-app-only and mislabels it "done."
- *Correction:* clarify that **V1 notifications are in-app/ranked**; **push delivery is gated on push infrastructure (TARGET)**; NOT-005 applies whenever push ships.
- *Compat:* additive. *Impl:* phase push. *PO:* **YES** (V1 push in/out). *Counsel:* No.

**F-08 · P1 (Rule-20) · KEY-002 · K-2 · Class-B server key could be co-located with the data it "protects."**
- *Problem:* KEY-002 says a "new server/KMS store" but doesn't require the key to be **isolated from the encrypted data** (separate KMS/secret manager, distinct access path).
- *Failure scenario:* implementer stores the per-user WELLBEING key in the same DB/table as the mood data → DB compromise exposes both; crypto-shred is theater.
- *Correction:* KEY-002 MUST require Class-B keys held in a **separate key store with independent access control**, not co-located with the data; acceptance: DB dump does not contain usable Class-B keys.
- *Compat:* additive. *Impl:* KMS/secret store. *PO:* No. *Counsel:* No.

**F-09 · P1 · MIG-001/002/003 · B-2/FLD-1/2 · Backfill actor undefined for shared/group fields; MIG-003 not gated on its ENG-UNKNOWN.**
- *Problem:* client backfill is specified, but for **shared** (`settlement.note`, `direct_ledger.note`) and **group** (`group.description`) fields the SRS doesn't say **who** runs the backfill or which key/version is used; MIG-003 isn't gated on resolving OQ-11 (pre-join display).
- *Failure scenario:* two members race to backfill a group description with different keys; or encrypting description breaks a pre-join invite preview.
- *Correction:* MIG-001/002/003 MUST define the backfill actor + key domain per field (e.g., group description → group key, backfilled by an active member; settlement/P2P note → per-entry key wrapped for both parties by the author). MIG-003 MUST be **gated on OQ-11** resolution.
- *Compat:* MEDIUM. *Impl:* backfill orchestration. *PO:* No. *Counsel:* No.

**F-10 · P1 (missing) · — · #11/Rule 1 · No requirement preserves import/export.**
- *Problem:* Rule 1 lists import/export as protected, and it exists in production (2 controllers), but the SRS has **no functional requirement** preserving it (only mentioned in §5 baseline).
- *Failure scenario:* a refactor breaks export decryption or import validation with no requirement catching it.
- *Correction:* add `IMP-001/EXP-001` (MUST, P1, CUR): preserve import/export including client-side decryption on export and validation on import; acceptance = round-trip fidelity test.
- *Compat:* none (preserve). *Impl:* add reqs. *PO:* No. *Counsel:* No.

**F-11 · P1 (clarity/contradiction-risk) · FUT-001, DATA-002 · A3 · Journal (E2EE) vs wellbeing analysis ambiguity.**
- *Problem:* DATA-002 lists **journal as E2EE (server can't read)**; FUT-001 lists **journaling under wellbeing** with "server-managed mood key" and analysis. A literal implementer could read the E2EE journal server-side for wellbeing analysis → violates E2EE (the exact Rule-3 contradiction).
- *Correction:* FUT-001 MUST state journal stays **E2EE / client-side analysis only**; **only numeric mood metrics** are Class-B server-readable. (Consistent with frozen A3 — this is a wording fix, not a decision change.)
- *Compat:* n/a. *Impl:* clarify. *PO:* No. *Counsel:* No (but Art. 9 already flagged).

**F-12 · P1 · PRIV-002/PRIV-004, INT-004 · INT-4 · Withdrawal could delete the durable suppression it must preserve.**
- *Problem:* PRIV-004 (withdrawal "invalidates derived data") and INT-004 (suppression stored independently, survives re-consent) are correct individually but **not cross-linked**; a literal implementer treating suppression as "derived data" would delete it on withdrawal → rejected inference resurrects after re-consent (the N1 trap).
- *Correction:* PRIV-004 MUST explicitly **exclude suppression/override records** from withdrawal-driven invalidation; acceptance = withdraw→re-consent→recompute keeps the rejected inference suppressed.
- *Compat:* additive. *Impl:* separate store. *PO:* No. *Counsel:* No.

## 4. P2 issues

**F-13 · P2 (untestable) · UX-002/003/008 ·** "decision-oriented card," "non-judgmental language," "success measured by outcomes not opens/streaks" have **subjective/unverifiable** acceptance. UX-008 is a **metrics philosophy, not a software requirement**. *Correction:* make UX-008 testable as "product MUST NOT implement streak/engagement mechanics" (verifiable: absence of such code); reframe UX-002/003 acceptance as design-review checklists, not pass/fail tests.

**F-14 · P2 (CUR/TARGET labels) · GRP-003, GRP-006 ·** `group.name`/`invitedEmail` already **exist** (CURRENT, plaintext) — marking them V1C blurs "protected existing field" vs "new behaviour." *Correction:* label the *field* CUR and the *new behaviour* (retention purge, no-AI) additive.

**F-15 · P2 (hidden thresholds) · GOAL-007 ("periodically"), UX-007 ("≤N items"), FIN-007 ("smart defaults"), NOT thresholds ·** unstated frequencies/counts = latent product decisions. *Correction:* mark each `[PRODUCT DECISION REQUIRED]` (several already in OQ-06/07; add GOAL-007 frequency and UX-007 cap).

**F-16 · P2 (isolation test strength) · SEC-ISO-001 ·** should mandate the app uses **per-domain connection credentials** and add a test that a domain role is **denied** cross-schema reads (else "separate schemas" passes while the boundary is fake — Rule 9/20).

**F-17 · P2 (missing) · — ·** no requirement preserves **existing rate-limiting/throttler**, the **email (Resend) dependency** for auth flows, or the **existing audit_logs** capability. Also missing: explicit **household month-lock** preservation and **spectator-never-in-splits** test. *Correction:* add REL/SEC/OBS/FIN preservation requirements.

**F-18 · P2 (legal assumption) · PRIV-006 ·** states "legitimate interest for Level-1 finance aggregates" — an assumed legal basis. *Correction:* tag `[COUNSEL REQUIRED]` (already in CON-3; surface on PRIV-006). *Counsel:* YES.

## 5–20. Category summaries (as delivered)
- **Compatibility scoring:** FIN-002 CRITICAL; auth transport HIGH; note-encryption backfills MEDIUM; AI firewall/proxy rework MEDIUM; domain isolation MEDIUM; quick-add MEDIUM; goal column widen LOW.
- **Financial-correctness issues:** F-01 (highest risk).
- **Security contradictions:** none with frozen decisions; weaknesses F-08, F-16, F-02.
- **Privacy/legal gaps:** F-12, F-18; retention correctly deferred.
- **AI/firewall gaps:** F-04, F-05, F-11.
- **Migration gaps:** F-09; MIG-008 present; no clean-slate assumption.
- **Mobile/web gaps:** F-02 sequencing, F-07 push dependency; MOB-001 correctly web-wrapped.
- **Current-vs-target errors:** F-14 minor label blur; no TARGET-as-CURRENT.
- **Hidden product decisions:** F-06, F-07, F-15, OQ-09.
- **Untestable requirements:** F-13.
- **Scope concerns:** F-06 personalization, F-07 push.
- **Dependency problems:** no circular dependency; long paths flagged (personalization→intelligence→outbox→isolation→DPIA; MIG-003→OQ-11; SEC-003→auth paths).
- **Missing requirements:** F-10, F-17.
- **Unnecessarily complex:** none material.
- **Could break existing functionality:** F-01 (CRITICAL) > F-02 (HIGH) > F-09 (MEDIUM) > AI rework (MEDIUM).
- **Contradictions with frozen documents:** NONE — all findings are SRS clarity/scoping/acceptance gaps.

*End of saved adversarial review (verbatim record).*
