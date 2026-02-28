export type TerminalCommandSetting = "claude" | "opencode" | "copilot" | "custom" | "none";

export interface ProjectSettings {
  terminalCommand: TerminalCommandSetting;
  customCommand?: string;
}

export type Mode = "build" | "review";

export interface SetupScreenProps {
  onSelect: (folderPath: string) => void;
}
