import { Terminal } from "./Terminal";

interface BuildModeProps {
  isVisible: boolean;
  cwd: string;
  terminalCommand?: string;
}

export function BuildMode({ isVisible, cwd, terminalCommand }: BuildModeProps) {
  return <Terminal isVisible={isVisible} cwd={cwd} terminalCommand={terminalCommand} />;
}
