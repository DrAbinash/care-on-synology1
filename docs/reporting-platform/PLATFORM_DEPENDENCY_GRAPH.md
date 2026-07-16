# CARE Reporting Platform — Dependency Graph

The Reporting Platform is **one modality-agnostic system**. A study of any
modality (MRI, USG, CT, X-Ray, and future modalities) opens the *same* Reporting
Workspace, which resolves a **Knowledge Pack** and, from it and the shared
content tables, drives every capability. Adding a modality means adding a
Knowledge Pack + clinical content — never a new node in this graph.

## Capability dependency graph

```mermaid
flowchart TD
    WL[Worklist / Study Launch<br/>?modality=&accession=] --> WS[Reporting Workspace<br/>RadiologyReportingWorkspace.tsx<br/>ONE instance, modality-agnostic]
    WS --> RR[Study→Region Resolver<br/>studyRegion.ts · most-specific wins]
    RR --> KP[Knowledge Pack<br/>knowledge_packs · manifest_json<br/>SOURCE OF TRUTH]

    KP --> TPL[Templates<br/>structured_report_templates]
    KP --> PROTO[Protocols<br/>radiology_protocols]
    KP --> HIST[Clinical History<br/>history chips]
    KP --> QF[Quick + Structured Findings<br/>radiology_quick_findings · questionsJson]
    KP --> MEAS[Measurements<br/>radiology_quick_measurements · viewer SR]

    QF --> COMP[Companion<br/>UsgCompanionPanel · ONE shared panel]
    PROTO --> COMP
    HIST --> COMP
    MEAS --> COMP

    KP --> COPILOT[Copilot<br/>copilotOrchestrator · module registry]
    MEAS --> COPILOT
    KP --> CMP[Previous Comparison<br/>radiologyComparison · comparisonMeasurements]
    MEAS --> CMP

    QF --> QUAL[Quality Engine<br/>lib/report-quality · shared rules]
    MEAS --> QUAL
    PROTO --> QUAL

    KP --> KB[Knowledge Base<br/>radiologyKnowledge · articles]
    KP --> TEACH[Teaching Cases<br/>teaching_cases]

    WS --> VOICE[Voice · useVoiceSession]
    WS --> PALETTE[Command Palette · workspaceCommands]
    WS --> PRINT[Print / PDF<br/>Premium Layout · print-preview]
    WS --> FINAL[Finalize + Sign<br/>finalizeReport · finalizeSafety]

    QUAL --> FINAL
    COPILOT --> FINAL
```

## Reading the graph

- **Worklist → Workspace.** A study opens the one canonical workspace via
  `?modality=&accession=`; there is no per-modality workspace.
- **Workspace → Resolver → Knowledge Pack.** The workspace resolves the study's
  region (`studyRegion.ts`, most-specific match), which selects the Knowledge
  Pack. The pack is the **source of truth** for that study's clinical behaviour.
- **Knowledge Pack → content.** Templates, protocols, history, findings and
  measurements are loaded from the shared content tables, keyed by the resolved
  region/study — CT/USG/XR/MRI rows sit side by side in the same tables.
- **Content → higher-order capabilities.** Companion (composes protocol +
  history + findings + measurements + Copilot), Copilot (module registry +
  measurement completeness), Comparison (pack `comparisonMeasurements`) and the
  Quality Engine all read the shared content — none is modality-specific.
- **Workspace-level services.** Voice, Command Palette, Print and Finalize are
  modality-agnostic and gated only by user preference / report state, never by
  modality.

## The invariant this encodes

Every arrow terminates at a **single** implementation. The platform contract
suite (`platform-contract.test.ts`, Step 4) asserts exactly one Workspace,
Companion, Copilot, Comparison engine, Knowledge-Pack engine, Template engine,
resolver and Quality-Engine package exist, and that **no modality-prefixed
second implementation** appears anywhere. If a `CtWorkspace`, `MriCopilot`, or
`UsgQualityEngine` is ever introduced, the suite fails.

> A future modality (PET-CT, Nuclear Medicine, Mammography, Fluoroscopy, DEXA)
> enters this graph **only** as a new Knowledge Pack + clinical content. No new
> node, no new arrow, no new engine.
