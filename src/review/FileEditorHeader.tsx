export function FileEditorHeader({
  filePath,
  cwd,
  isDirty,
  saveStatus,
  isImage,
}: {
  filePath: string;
  cwd: string;
  isDirty: boolean;
  saveStatus: string | null;
  isImage: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold flex items-center gap-2 shrink-0">
      <span className="truncate">{filePath.replace(cwd + "/", "")}</span>
      {isDirty && <span className="text-[#dcdcaa]">(unsaved)</span>}
      {saveStatus && (
        <span className={saveStatus === "Saved" ? "text-[#6a9955]" : "text-[#f44747]"}>
          {saveStatus}
        </span>
      )}
      {!isImage && (
        <span className="ml-auto text-[10px] text-[#555]">Cmd+S to save</span>
      )}
    </div>
  );
}
