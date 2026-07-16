// rules/index.ts — the rule registration hub.
//
// Each phase adds rule modules under this directory; importing them here (for
// their registerRule() side effects) is what makes `import "@workspace/
// report-quality"` wire the full rule set. Phase 0 registers no rules yet — the
// engine runs and returns an empty, honest report until Phase 1 lands the
// text-tier rules.
//
// Later phases append, e.g.:
//   import "./measurement/out-of-range";
//   import "./completeness/checklist";

// Phase 1: free-text (heuristic) tier — wraps the legacy validator/score.
import "./text";

export {};
