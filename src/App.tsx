import { useState, useMemo, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SetupScreen, getProjectSettings, saveProjectSettings, resolveTerminalCommand, type TerminalCommandSetting, type ProjectSettings } from "./general/SetupScreen";
import { BuildMode } from "./build/BuildMode";
import { ReviewMode } from "./review/ReviewMode";
import { StatusBar } from "./general/StatusBar";

type Mode = "build" | "review";

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(() => {
    // Only auto-load last project for the initial window;
    // new windows (main-1, main-2, …) always start on the folder select screen
    if (getCurrentWebviewWindow().label === "main") {
      return localStorage.getItem("lastProject");
    }
    return null;
  });
  const [activeMode, setActiveMode] = useState<Mode>("build");
  const [terminalSettingVersion, setTerminalSettingVersion] = useState(0);

  const selectProject = (path: string | null) => {
    setProjectPath(path);
    if (path) {
      localStorage.setItem("lastProject", path);
    } else {
      localStorage.removeItem("lastProject");
    }
  };

  const projectSettings = useMemo(() => {
    if (!projectPath) return null;
    // terminalSettingVersion is used to trigger re-read after changes
    void terminalSettingVersion;
    return getProjectSettings(projectPath);
  }, [projectPath, terminalSettingVersion]);

  const terminalCommand = useMemo(() => {
    if (!projectSettings) return undefined;
    return resolveTerminalCommand(projectSettings);
  }, [projectSettings]);

  const handleChangeTerminalCommand = useCallback((setting: TerminalCommandSetting, customCmd?: string) => {
    if (!projectPath) return;
    const settings: ProjectSettings = { terminalCommand: setting };
    if (setting === "custom" && customCmd) {
      settings.customCommand = customCmd;
    }
    saveProjectSettings(projectPath, settings);
    setTerminalSettingVersion((v) => v + 1);
  }, [projectPath]);

  if (!projectPath) {
    return <SetupScreen onSelect={selectProject} />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        <BuildMode isVisible={activeMode === "build"} cwd={projectPath} terminalCommand={terminalCommand} />
        <ReviewMode isVisible={activeMode === "review"} cwd={projectPath} onModeChange={setActiveMode} />
      </div>
      <StatusBar
        repoPath={projectPath}
        activeMode={activeMode}
        onModeChange={setActiveMode}
        onChangeProject={() => selectProject(null)}
        terminalSetting={projectSettings?.terminalCommand ?? "claude"}
        customCommand={projectSettings?.customCommand}
        onChangeTerminalCommand={handleChangeTerminalCommand}
      />
    </div>
  );
}

export default App;
