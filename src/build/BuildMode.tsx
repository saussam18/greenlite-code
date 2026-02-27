import { Terminal } from "./Terminal";

interface BuildModeProps {
  isVisible: boolean;
  cwd: string;
}

export function BuildMode({ isVisible, cwd }: BuildModeProps) {
  return <Terminal isVisible={isVisible} cwd={cwd} />;
}
