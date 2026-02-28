export type TerminalCommandSetting = "claude" | "opencode" | "copilot" | "custom" | "none";

export interface ProjectSettings {
  terminalCommand: TerminalCommandSetting;
  customCommand?: string;
}

export type Mode = "build" | "review";
