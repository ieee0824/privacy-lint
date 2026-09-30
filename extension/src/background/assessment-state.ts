import type { Assessment, TabStatus } from "../shared/assessment";

export interface RunIdentity { readonly generation: number }
export interface EvaluationState {
  run: RunIdentity;
  status: TabStatus;
  focused: boolean;
}
export type EvaluationEvent =
  | { type: "start"; focused: boolean }
  | { type: "reset" }
  | { type: "settings-changed" }
  | { type: "focus" }
  | { type: "cached" | "result"; run: RunIdentity; assessment: Assessment };
export type EvaluationOperation = "evaluate" | "clear" | "publish" | "notify";

export function initialEvaluationState(): EvaluationState {
  return { run: Object.freeze({ generation: 0 }), status: { kind: "idle" }, focused: false };
}

/** The executor owns run identities; equality here is their explicit generation. */
export function transitionEvaluation(state: EvaluationState, event: EvaluationEvent): {
  state: EvaluationState; operations: EvaluationOperation[];
} {
  if (event.type === "start") return {
    state: { run: Object.freeze({ generation: state.run.generation + 1 }), focused: event.focused,
      status: { kind: "assessing", focused: event.focused } },
    operations: ["evaluate"],
  };
  if (event.type === "reset" || event.type === "settings-changed") return {
    state: { run: Object.freeze({ generation: state.run.generation + 1 }), status: { kind: "idle" },
      focused: event.type === "settings-changed" && state.focused }, operations: ["clear"],
  };
  if (event.type === "focus") return focusTransition(state);
  if (event.run.generation !== state.run.generation || state.status.kind === "idle") return { state: copyState(state), operations: [] };
  const focused = state.focused;
  return { state: { ...state, status: { kind: "done", focused, assessment: structuredClone(event.assessment) } },
    operations: focused ? ["publish", "notify"] : ["publish"] };
}

function focusTransition(state: EvaluationState) {
  if (state.status.kind === "idle" || state.status.focused) return { state: copyState(state), operations: [] };
  const operations: EvaluationOperation[] = state.status.kind === "done" ? ["publish", "notify"] : ["publish"];
  return { state: { ...state, focused: true, status: { ...structuredClone(state.status), focused: true } }, operations };
}

function copyState(state: EvaluationState): EvaluationState {
  return { ...state, status: structuredClone(state.status) };
}
