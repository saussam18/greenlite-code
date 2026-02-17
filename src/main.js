const { open, save } = window.__TAURI__.dialog;
const { readTextFile, writeTextFile } = window.__TAURI__.fs;

let currentFilePath = null;

const editorEl = document.getElementById("editor");
const filenameEl = document.getElementById("filename");
const saveBtn = document.getElementById("save-btn");

document.getElementById("open-btn").addEventListener("click", openFile);
saveBtn.addEventListener("click", saveFile);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "o") {
    e.preventDefault();
    openFile();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveFile();
  }
});

async function openFile() {
  const path = await open({
    multiple: false,
    filters: [
      { name: "Text files", extensions: ["txt", "md", "json", "js", "ts", "rs", "html", "css", "toml", "yaml", "yml", "xml", "csv", "log", "py", "rb", "sh"] },
      { name: "All files", extensions: ["*"] },
    ],
  });

  if (!path) return;

  const contents = await readTextFile(path);
  currentFilePath = path;
  editorEl.value = contents;
  editorEl.disabled = false;
  saveBtn.disabled = false;
  filenameEl.textContent = path;
}

async function saveFile() {
  if (!currentFilePath) return;

  await writeTextFile(currentFilePath, editorEl.value);
  filenameEl.textContent = currentFilePath + " (saved)";
  setTimeout(() => {
    filenameEl.textContent = currentFilePath;
  }, 1500);
}
