import type { ProjectSettings } from "../types/settings";

export function getProjectSettings(path: string): ProjectSettings | null {
  try {
    const raw = localStorage.getItem(`projectSettings:${path}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveProjectSettings(path: string, settings: ProjectSettings) {
  localStorage.setItem(`projectSettings:${path}`, JSON.stringify(settings));
}

export function resolveTerminalCommand(settings: ProjectSettings): string | undefined {
  switch (settings.terminalCommand) {
    case "claude": return "claude";
    case "opencode": return "opencode";
    case "copilot": return "copilot";
    case "custom": return settings.customCommand || undefined;
    case "none": return undefined;
  }
}
