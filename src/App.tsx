import { useState } from "react";
import { FileViewer } from "./FileViewer";
import { Terminal } from "./Terminal";

type Tab = "editor" | "terminal";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("editor");

  return (
    <div className="app-container">
      <div className="tab-bar">
        <button
          className={`tab ${activeTab === "editor" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("editor")}
        >
          Editor
        </button>
        <button
          className={`tab ${activeTab === "terminal" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("terminal")}
        >
          Terminal
        </button>
      </div>
      <div className="tab-content">
        <FileViewer isVisible={activeTab === "editor"} />
        <Terminal isVisible={activeTab === "terminal"} />
      </div>
    </div>
  );
}

export default App;
