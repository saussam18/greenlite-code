import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  isVisible: boolean;
  cwd: string;
}

export function Terminal({ isVisible, cwd }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const initializedRef = useRef(false);

  const initTerminal = useCallback(async () => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const term = new XTerm({
      theme: {
        background: "#1a1a1a",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#1e1e1e",
        brightBlack: "#555555",
        red: "#f44747",
        brightRed: "#f44747",
        green: "#6a9955",
        brightGreen: "#b5cea8",
        yellow: "#dcdcaa",
        brightYellow: "#dcdcaa",
        blue: "#569cd6",
        brightBlue: "#9cdcfe",
        magenta: "#c586c0",
        brightMagenta: "#c586c0",
        cyan: "#4ec9b0",
        brightCyan: "#4ec9b0",
        white: "#d4d4d4",
        brightWhite: "#ffffff",
      },
      fontFamily:
        '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const { rows, cols } = term;

    await invoke("pty_create", { rows, cols, cwd });

    unlistenRef.current = await listen<string>("pty-output", (event) => {
      term.write(event.payload);
    });

    term.onData((data: string) => {
      invoke("pty_write", { data }).catch(console.error);
    });

    term.onResize(({ rows, cols }) => {
      invoke("pty_resize", { rows, cols }).catch(console.error);
    });
  }, [cwd]);

  useEffect(() => {
    if (!isVisible) return;

    const id = setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      } else {
        initTerminal();
      }
    }, 50);

    return () => clearTimeout(id);
  }, [isVisible, initTerminal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && isVisible) {
        fitAddonRef.current.fit();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      xtermRef.current?.dispose();
    };
  }, []);

  return (
    <div
      className="flex flex-col flex-1 bg-[#1a1a1a] min-h-0"
      style={{ display: isVisible ? "flex" : "none" }}
    >
      <div className="flex items-center px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] tracking-wider text-[#888] shrink-0 select-none">
        <span>TERMINAL</span>
      </div>
      <div ref={containerRef} className="terminal-container flex-1 overflow-hidden p-1 min-h-0" />
    </div>
  );
}
