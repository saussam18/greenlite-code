import type { TerminalCommandSetting, Mode } from "./settings";
import type { ReviewInfo } from "./review";

export interface StatusBarProps {
  repoPath: string;
  activeMode: Mode;
  onModeChange: (mode: Mode) => void;
  onChangeProject: () => void;
  terminalSetting: TerminalCommandSetting;
  customCommand?: string;
  onChangeTerminalCommand: (setting: TerminalCommandSetting, customCmd?: string) => void;
  reviewInfo?: ReviewInfo | null;
}
