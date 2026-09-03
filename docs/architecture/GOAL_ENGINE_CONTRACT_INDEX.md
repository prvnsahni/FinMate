# FinMate — Goal Engine Contract Index

**Companion to** [FINMATE_GOAL_ENGINE_ARCHITECTURE.md](FINMATE_GOAL_ENGINE_ARCHITECTURE.md). **Design/contract only — no code, schema, migration, ML, package, or production change.** Section refs point into the main document.

---

## Goal Engine in 5 Minutes

You set a money goal; a small "goal helper" reads **only the numbers you already own**, gives an **honest, explainable** projection ("at your pace you'd reach it ~2 months late; +₹5,000/month fixes it"), never shames you, never promises certainty, never gives investment advice. It lives **behind one stable doorway** so a smarter, population-informed engine can replace it later **without changing the app** — and only via a consented, legally-reviewed, firewall-bound path. **Runtime answering, checking outcomes, and training are three separate things; runtime data is never silently used for training.**

---

## Contract elements

| ID        | Element                                                                               | Status | Ref |
| --------- | ------------------------------------------------------------------------------------- | ------ | --- |
| GEC-IFACE | `GoalEngine` interface (`project`, `capabilities`, name/version/kind/contractVersion) | design | §5  |
| GEC-IN    | `GoalProjectionInput` (numeric/enum only; no free-text/keys/PII)                      | design | §6  |
| GEC-OUT   | `GoalProjectionResult` (projection + confidence + explanation + provenance + status)  | design | §7  |
| GEC-SCEN  | `ScenarioInput` / `ScenarioResult` (read-only what-ifs)                               | design | §8  |
| GEC-CONF  | Confidence/uncertainty (data-sufficiency V1; calibrated model V2)                     | design | §9  |
| GEC-EXPL  | Explainability metadata (inputs/assumptions/method/version/kind)                      | design | §10 |
| GEC-FAIL  | Failure states (insufficient_data … low_confidence)                                   | design | §21 |
| GEC-VER   | Contract vs engine versioning; model replacement                                      | design | §20 |
| GEC-PORT  | Portfolio/Asset projection extension point (FUTURE)                                   | design | §15 |
| GEC-FW    | AI firewall compatibility (external steps only)                                       | design | §17 |

## Engine implementations (behind the same interface)

| Engine                       | Kind          | Status                                          |
| ---------------------------- | ------------- | ----------------------------------------------- |
| DeterministicGoalEngine      | deterministic | **V1** (explainable arithmetic; no AI)          |
| ModelInformedGoalEngine      | model         | **V2** (firewall-bound; calibrated confidence)  |
| PopulationInformedGoalEngine | population    | **FUTURE** (aggregate, consent + COUNSEL gated) |

## Data-separation (never conflate)

1 Goal state · 2 Engine input projection · 3 Engine output (runtime) · 4 Observed outcome · 5 Evaluation/training candidate (consent + COUNSEL gated). Runtime **never** auto-feeds training (§13/§14).

## Never sent to any engine

E2EE free-text (goal title, journal) · contacts · auth data · encryption keys · raw DB dumps · unnecessary PII. External steps go through the AI firewall (numeric/enum + consent + ZDR).

## Open decisions (none resolved here)

| ID    | Question                                             | Type                                 |
| ----- | ---------------------------------------------------- | ------------------------------------ |
| GE-1  | May user data ever be used for training?             | PRODUCT + COUNSEL + consent          |
| GE-2  | Training dataset composition / retention             | ENGINEERING / COUNSEL                |
| GE-3  | Legal basis for population learning                  | COUNSEL                              |
| GE-4  | Differential privacy / federated vs central          | ENGINEERING                          |
| GE-5  | Model provider (internal/external)                   | PRODUCT / VEN-1                      |
| GE-6  | Investment-recommendation policy                     | PRODUCT DECISION REQUIRED (existing) |
| GE-7  | Confidence cutoffs / min-data / freshness            | ENGINEERING PARAMETER                |
| GE-8  | Supported goal types beyond savings                  | PRODUCT                              |
| GE-9  | Goal priority ordering semantics                     | PRODUCT / UX (V1)                    |
| GE-10 | Accuracy/calibration/drift thresholds                | ENGINEERING PARAMETER                |
| GE-11 | Where evaluation/prediction records live + retention | ENGINEERING / COUNSEL                |

## Current reality

Goals = **PLACEHOLDER** (`goals` entity/table only; no service/API/engine; `title` plaintext today → B-1 born-E2EE target). Goal Engine = **does not exist**. No contradiction with frozen docs.

---

_Index for the Goal Engine Architecture & Contract. No code/schema/DB/migration/ML/package/production change. STOP — engine not implemented._
