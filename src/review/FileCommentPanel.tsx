export function FileCommentPanel({
  line,
  text,
  onTextChange,
  onSubmit,
  onCancel,
}: {
  line: number;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-[#404040] bg-[#252526] p-3">
      <div className="text-[11px] text-[#888] mb-1.5">
        Comment on line {line}
      </div>
      <textarea
        className="w-full min-h-[60px] px-2 py-1.5 border border-[#555] rounded bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[13px] resize-y outline-none focus:border-[#4e9a06]"
        placeholder="Add a comment..."
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-[#555]">Cmd+Enter to submit</span>
        <div className="flex gap-1.5">
          <button
            onClick={onCancel}
            className="px-3 py-1 border border-[#555] rounded bg-[#3c3c3c] text-[#d4d4d4] cursor-pointer text-xs hover:bg-[#4a4a4a]"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!text.trim()}
            className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-xs hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
