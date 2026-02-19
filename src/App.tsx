import { useState } from "react";
import { SetupScreen } from "./SetupScreen";
import { BuildMode } from "./BuildMode";
import { ReviewMode } from "./ReviewMode";
import { StatusBar } from "./StatusBar";

type Mode = "build" | "review";

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<Mode>("build");

  if (!projectPath) {
    return <SetupScreen onSelect={setProjectPath} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        <BuildMode isVisible={activeMode === "build"} cwd={projectPath} />
        <ReviewMode isVisible={activeMode === "review"} cwd={projectPath} />
      </div>
      <StatusBar
        repoPath={projectPath}
        activeMode={activeMode}
        onModeChange={setActiveMode}
      />
    </div>
  );
}

export default App;
