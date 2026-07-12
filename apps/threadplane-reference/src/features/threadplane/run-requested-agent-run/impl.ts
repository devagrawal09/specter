import runRequestedAgentRunSpec from "./spec";

import { createMemorySliceStore } from "../../../testing/memory-slice-store";
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  toolCallStartedEvent,
} from "../events";
import {
  buildFailureMessage,
  buildStreamChunks,
  getSimulatedAgentPlan,
  pickToolName,
  shouldFailRun,
} from "../simulated-agent-plan";

type AgentRunJob = {
  runId: string;
  workspaceId: string;
  postId?: string;
  agentId: string;
  agentName: string;
};

type RunRequestedAgentRunCommand =
  | {
      type: "recordAgentRunStarted";
      payload: {
        runId: string;
        workspaceId: string;
        agentId: string;
      };
    }
  | {
      type: "recordToolCallStarted";
      payload: {
        toolCallId: string;
        runId: string;
        workspaceId: string;
        agentId: string;
        toolName: string;
        inputSummary?: string;
      };
    }
  | {
      type: "recordToolCallCompleted";
      payload: {
        toolCallId: string;
        runId: string;
        workspaceId: string;
        agentId: string;
        toolName: string;
        outputSummary?: string;
      };
    }
  | {
      type: "recordToolCallFailed";
      payload: {
        toolCallId: string;
        runId: string;
        workspaceId: string;
        agentId: string;
        toolName: string;
        error: string;
      };
    }
  | {
      type: "recordAgentRunStreamed";
      payload: {
        runId: string;
        workspaceId: string;
        agentId: string;
        chunkId: string;
        sequence: number;
        delta: string;
      };
    }
  | {
      type: "recordAgentRunCompleted";
      payload: {
        runId: string;
        workspaceId: string;
        agentId: string;
      };
    }
  | {
      type: "recordAgentRunFailed";
      payload: {
        runId: string;
        workspaceId: string;
        agentId: string;
        error: string;
      };
    };

type RunRequestedAgentRunState = {
  requestedRuns: AgentRunJob[];
  runPlans: Record<
    string,
    {
      toolName: string;
      chunks: string[];
      shouldFail: boolean;
      failed: boolean;
      completed: boolean;
      toolStarted: boolean;
      toolCompleted: boolean;
      streamIndex: number;
    }
  >;
  startedRunIds: Set<string>;
  terminalRunIds: Set<string>;
};

export function createRunRequestedAgentRunState(): RunRequestedAgentRunState {
  return {
    requestedRuns: [],
    runPlans: {},
    startedRunIds: new Set(),
    terminalRunIds: new Set(),
  };
}

export function nextRunRequestedAgentRunCommand(
  state: RunRequestedAgentRunState,
): RunRequestedAgentRunCommand | undefined {
  const nextRun = state.requestedRuns.find(
    (run) => !state.terminalRunIds.has(run.runId),
  );

  if (!nextRun) return undefined;

  const plan = state.runPlans[nextRun.runId];
  if (!plan) return undefined;

  if (!state.startedRunIds.has(nextRun.runId)) {
    return {
      type: "recordAgentRunStarted",
      payload: {
        runId: nextRun.runId,
        workspaceId: nextRun.workspaceId,
        agentId: nextRun.agentId,
      },
    };
  }

  if (!plan.toolStarted) {
    return {
      type: "recordToolCallStarted",
      payload: {
        toolCallId: `${nextRun.runId}-tool-1`,
        runId: nextRun.runId,
        workspaceId: nextRun.workspaceId,
        agentId: nextRun.agentId,
        toolName: plan.toolName,
        inputSummary: "Simulated workspace inspection",
      },
    };
  }

  if (!plan.toolCompleted) {
    if (plan.shouldFail && !plan.failed) {
      return {
        type: "recordToolCallFailed",
        payload: {
          toolCallId: `${nextRun.runId}-tool-1`,
          runId: nextRun.runId,
          workspaceId: nextRun.workspaceId,
          agentId: nextRun.agentId,
          toolName: plan.toolName,
          error: buildFailureMessage(plan.toolName),
        },
      };
    }

    return {
      type: "recordToolCallCompleted",
      payload: {
        toolCallId: `${nextRun.runId}-tool-1`,
        runId: nextRun.runId,
        workspaceId: nextRun.workspaceId,
        agentId: nextRun.agentId,
        toolName: plan.toolName,
        outputSummary: `Simulated ${plan.toolName} output`,
      },
    };
  }

  if (plan.shouldFail || plan.failed) {
    return {
      type: "recordAgentRunFailed",
      payload: {
        runId: nextRun.runId,
        workspaceId: nextRun.workspaceId,
        agentId: nextRun.agentId,
        error: buildFailureMessage(plan.toolName),
      },
    };
  }

  if (plan.streamIndex < plan.chunks.length) {
    return {
      type: "recordAgentRunStreamed",
      payload: {
        chunkId: `${nextRun.runId}-chunk-${plan.streamIndex + 1}`,
        runId: nextRun.runId,
        workspaceId: nextRun.workspaceId,
        agentId: nextRun.agentId,
        sequence: plan.streamIndex,
        delta: plan.chunks[plan.streamIndex],
      },
    };
  }

  return {
    type: "recordAgentRunCompleted",
    payload: {
      runId: nextRun.runId,
      workspaceId: nextRun.workspaceId,
      agentId: nextRun.agentId,
    },
  };
}

const runRequestedAgentRun = runRequestedAgentRunSpec
  .outputSchema<RunRequestedAgentRunCommand>()
  .plugin(async (dispatch) => async (payload) => {
    await dispatch(payload as never);
  })
  .store(
    createMemorySliceStore<RunRequestedAgentRunState>(
      createRunRequestedAgentRunState,
    ),
  )
  .apply(agentRunRequestedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof agentRunRequestedEvent.decode>
    >;
    const plan = getSimulatedAgentPlan(payload.runId);

    state.requestedRuns.push(payload);
    state.runPlans[payload.runId] = {
      toolName: pickToolName(plan.seed, payload.runId),
      chunks: buildStreamChunks(plan.seed, payload.runId),
      shouldFail: shouldFailRun(plan.seed, payload.runId),
      failed: false,
      completed: false,
      toolStarted: false,
      toolCompleted: false,
      streamIndex: 0,
    };
  })
  .apply(agentRunStartedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof agentRunStartedEvent.decode>
    >;
    state.startedRunIds.add(payload.runId);
  })
  .apply(toolCallStartedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof toolCallStartedEvent.decode>
    >;
    const plan = state.runPlans[payload.runId];
    if (plan) plan.toolStarted = true;
  })
  .apply(toolCallCompletedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof toolCallCompletedEvent.decode>
    >;
    const plan = state.runPlans[payload.runId];
    if (plan) plan.toolCompleted = true;
  })
  .apply(toolCallFailedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof toolCallFailedEvent.decode>
    >;
    const plan = state.runPlans[payload.runId];
    if (plan) {
      plan.failed = true;
      plan.toolCompleted = true;
    }
  })
  .apply(agentRunStreamedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof agentRunStreamedEvent.decode>
    >;
    const plan = state.runPlans[payload.runId];
    if (plan) plan.streamIndex = payload.sequence + 1;
  })
  .apply(agentRunCompletedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof agentRunCompletedEvent.decode>
    >;
    const plan = state.runPlans[payload.runId];
    if (plan) plan.completed = true;
    state.terminalRunIds.add(payload.runId);
  })
  .apply(agentRunFailedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof agentRunFailedEvent.decode>
    >;
    const plan = state.runPlans[payload.runId];
    if (plan) plan.failed = true;
    state.terminalRunIds.add(payload.runId);
  })
  .handle(async (state): Promise<RunRequestedAgentRunCommand | undefined> => {
    return nextRunRequestedAgentRunCommand(state);
  });

export default runRequestedAgentRun;
