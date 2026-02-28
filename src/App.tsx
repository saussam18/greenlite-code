import { useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SetupScreen } from "./general/SetupScreen";
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

  const selectProject = (path: string | null) => {
    setProjectPath(path);
    if (path) {
      localStorage.setItem("lastProject", path);
    } else {
      localStorage.removeItem("lastProject");
    }
  };

  if (!projectPath) {
    return <SetupScreen onSelect={selectProject} />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        <BuildMode isVisible={activeMode === "build"} cwd={projectPath} />
        <ReviewMode isVisible={activeMode === "review"} cwd={projectPath} onModeChange={setActiveMode} />
      </div>
      <StatusBar
        repoPath={projectPath}
        activeMode={activeMode}
        onModeChange={setActiveMode}
        onChangeProject={() => selectProject(null)}
      />
    </div>
  );
}

export default App;
