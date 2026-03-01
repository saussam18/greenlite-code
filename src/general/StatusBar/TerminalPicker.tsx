import { useState, useEffect, useRef } from "react";
import type { TerminalCommandSetting } from "../../types/settings";

const TERMINAL_LABELS: Record<TerminalCommandSetting, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  copilot: "Copilot",
  custom: "Custom",
  none: "None",
};

const TERMINAL_OPTIONS: { value: TerminalCommandSetting; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "custom", label: "Custom..." },
  { value: "none", label: "None (bare shell)" },
];

interface TerminalPickerProps {
  terminalSetting: TerminalCommandSetting;
  customCommand?: string;
  onChangeTerminalCommand: (setting: TerminalCommandSetting, customCmd?: string) => void;
}

export function TerminalPicker({ terminalSetting, customCommand, onChangeTerminalCommand }: TerminalPickerProps) {
  const [show, setShow] = useState(false);
  const [customCmd, setCustomCmd] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
        setCustomCmd("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [show]);

  const displayLabel = terminalSetting === "custom" && customCommand
    ? customCommand
    : TERMINAL_LABELS[terminalSetting];

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center gap-1.5 text-[13px] text-[#888] hover:text-[#ccc] cursor-pointer bg-transparent border-none font-mono shrink-0"
        onClick={() => setShow(!show)}
        title="Change terminal command (takes effect on next terminal)"
      >
        <span className="text-[#569cd6]">&gt;_</span>
        <span>{displayLabel}</span>
        <span className="text-[#555] text-[11px]">▼</span>
      </button>
      {show && (
        <div className="absolute bottom-full left-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] w-[240px] z-50">
          <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
            Terminal Command
          </div>
          {TERMINAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`flex items-center gap-3 w-full px-4 py-[8px] text-[14px] text-left bg-transparent border-none font-mono cursor-pointer hover:bg-white/[0.05] ${
                opt.value === terminalSetting ? "text-[#569cd6]" : "text-[#d4d4d4]"
              }`}
              onClick={() => {
                if (opt.value === "custom") return;
                onChangeTerminalCommand(opt.value);
                setShow(false);
              }}
            >
              <span className="w-[16px] shrink-0 text-[12px]">
                {opt.value === terminalSetting ? "●" : ""}
              </span>
              <span>{opt.label}</span>
            </button>
          ))}
          <form
            className="flex items-center gap-2 px-3 py-2.5 border-t border-[#404040]"
            onSubmit={(e) => {
              e.preventDefault();
              if (customCmd.trim()) {
                onChangeTerminalCommand("custom", customCmd.trim());
                setShow(false);
                setCustomCmd("");
              }
            }}
          >
            <input
              type="text"
              className="bg-[#1e1e1e] border border-[#555] rounded text-[13px] text-[#d4d4d4] px-2.5 py-1 h-[30px] flex-1 min-w-0 font-mono outline-none focus:border-[#888]"
              placeholder="Custom command..."
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
            />
            <button
              type="submit"
              disabled={!customCmd.trim()}
              className="px-2.5 py-1 border rounded text-[13px] font-bold cursor-pointer bg-transparent text-[#569cd6] border-[#569cd6] hover:bg-[#569cd6]/20 disabled:opacity-40 disabled:cursor-default h-[30px] shrink-0"
            >
              Set
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
