import { useState, useRef, useCallback, useEffect } from "react";
import { Terminal } from "./Terminal";

interface BuildModeProps {
  isVisible: boolean;
  cwd: string;
  terminalCommand?: string;
}

interface Tab {
  id: string;
  label: string;
}

export function BuildMode({ isVisible, cwd, terminalCommand }: BuildModeProps) {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "term-0", label: "Terminal 1" }]);
  const [activeTab, setActiveTab] = useState("term-0");
  const nextId = useRef(1);

  const addTab = useCallback(() => {
    const id = `term-${nextId.current++}`;
    const label = `Terminal ${tabs.length + 1}`;
    setTabs((prev) => [...prev, { id, label }]);
    setActiveTab(id);
  }, [tabs.length]);

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) return;
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        if (activeTab === tabId) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActive = filtered[Math.min(closedIndex, filtered.length - 1)];
          setActiveTab(newActive.id);
        }
        return filtered;
      });
    },
    [tabs.length, activeTab]
  );

  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "t") {
        e.preventDefault();
        addTab();
      }
      if (e.metaKey && e.key === "w") {
        e.preventDefault();
        closeTab(activeTab);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, addTab, closeTab, activeTab]);

  return (
    <div
      className="flex flex-col flex-1 bg-[#1a1a1a] min-h-0"
      style={{ display: isVisible ? "flex" : "none" }}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-[#2d2d2d] border-b border-[#404040] shrink-0 select-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 py-1 text-[11px] tracking-wider border-r border-[#404040] cursor-pointer ${
              activeTab === tab.id
                ? "bg-[#1a1a1a] text-[#d4d4d4]"
                : "text-[#888] hover:text-[#bbb] hover:bg-[#353535]"
            }`}
          >
            <span className="truncate">{tab.label.toUpperCase()}</span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="shrink-0 text-[10px] text-[#888] hover:text-[#d4d4d4] cursor-pointer"
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          onClick={addTab}
          className="shrink-0 px-4 py-1 text-[11px] text-[#888] hover:text-[#d4d4d4] hover:bg-[#353535] cursor-pointer"
          title="New terminal"
        >
          +
        </button>
      </div>

      {/* Terminal instances */}
      {tabs.map((tab) => (
        <Terminal
          key={tab.id}
          terminalId={tab.id}
          isVisible={activeTab === tab.id}
          cwd={cwd}
          terminalCommand={tab.id === "term-0" ? terminalCommand : undefined}
        />
      ))}
    </div>
  );
}
