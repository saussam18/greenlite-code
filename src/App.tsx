import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

function App() {
  const [content, setContent] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("No file open");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
// Hello world

  const lines = content.split("\n");
  const lineCount = lines.length;

  const syncScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const openFile = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [
        {
          name: "Text files",
          extensions: [
            "txt", "md", "json", "js", "jsx", "ts", "tsx", "rs", "html", "css",
            "toml", "yaml", "yml", "xml", "csv", "log", "py", "rb", "sh",
          ],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (!path) return;

    const text = await readTextFile(path);
    setContent(text);
    setFilePath(path);
    setStatusText(path);
  }, []);

  const saveFile = useCallback(async () => {
    if (!filePath) return;

    await writeTextFile(filePath, content);
    setStatusText(filePath + " (saved)");
    setTimeout(() => {
      setStatusText(filePath);
    }, 1500);
  }, [filePath, content]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        openFile();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openFile, saveFile]);

  return (
    <div className="editor-container">
      <div className="toolbar">
        <button onClick={openFile}>Open File</button>
        <button onClick={saveFile} disabled={!filePath}>
          Save
        </button>
        <span className="filename">{statusText}</span>
      </div>
      <div className="editor-area">
        <div className="line-numbers" ref={lineNumbersRef}>
          {filePath
            ? Array.from({ length: lineCount }, (_, i) => (
                <span key={i}>{i + 1}</span>
              ))
            : null}
        </div>
        <textarea
          ref={textareaRef}
          className="editor"
          placeholder="Open a file to start editing..."
          disabled={!filePath}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onScroll={syncScroll}
        />
      </div>
    </div>
  );
}

export default App;
