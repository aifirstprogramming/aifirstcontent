import type { Replay } from "../../src/types";

export interface ReplayPresentation {
  mode: "compact";
  phases: string[];
  verificationCommands: string[][];
  finalLaunch?: string[];
}

/** Apply authored presentation choices after reconstructing the source replay. */
export function applyReplayPresentation(replay: Replay, presentation?: ReplayPresentation): Replay {
  if (!presentation) return replay;

  replay.playback = { mode: presentation.mode, phases: presentation.phases };
  replay.operations.push(
    ...presentation.verificationCommands.map((command) => ({
      type: "command" as const,
      command,
      expectedExitCode: 0,
    })),
  );
  if (presentation.finalLaunch) {
    replay.operations.push({
      type: "command",
      command: presentation.finalLaunch,
      graphical: true,
      expectedExitCode: 0,
    });
  }
  return replay;
}
