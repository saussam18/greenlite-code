import { useState, useEffect, useRef } from "react";
import { MessageSquare, ChevronDown, ChevronUp, FileText, CheckCheck } from "lucide-react";
import type { ReviewInfo } from "../../types/review";

interface CommentsMenuProps {
  reviewInfo: ReviewInfo;
}

export function CommentsMenu({ reviewInfo }: CommentsMenuProps) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [show]);

  return (
    <div className="relative shrink-0" ref={ref}>
      {reviewInfo.openComments.length > 0 ? (
        <button
          className="flex items-center gap-1.5 cursor-pointer hover:text-[#ccc] bg-transparent border-none text-[14px] text-[#888] p-0 font-mono"
          onClick={() => setShow(!show)}
        >
          <MessageSquare size={14} />
          {reviewInfo.openComments.length} open comment{reviewInfo.openComments.length !== 1 ? "s" : ""}
          {reviewInfo.resolvedCount > 0 && (
            <span className="text-[#555]">
              &middot; {reviewInfo.resolvedCount} resolved
            </span>
          )}
          {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 text-[14px] text-[#888] font-mono">
          <MessageSquare size={14} />
          No comments
        </span>
      )}
      {show && reviewInfo.openComments.length > 0 && (
        <div className="absolute bottom-full right-0 mb-2 w-[380px] max-h-[320px] overflow-y-auto bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] z-50">
          {reviewInfo.openComments.map((c) => (
            <button
              key={c.id}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.06] cursor-pointer border-b border-[#404040] last:border-b-0 bg-transparent border-x-0 border-t-0"
              onClick={() => {
                reviewInfo.onNavigateToComment(c);
                setShow(false);
              }}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-[#888] mb-0.5">
                <FileText size={11} className="shrink-0" />
                <span className="truncate">{c.filePath}</span>
                <span className="text-[#555] shrink-0">
                  L{c.startLine}{c.startLine !== c.endLine ? `–${c.endLine}` : ""}
                </span>
              </div>
              <div className="text-[12px] text-[#d4d4d4] truncate">{c.text}</div>
            </button>
          ))}
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] text-[#888] hover:text-[#ccc] hover:bg-white/[0.06] cursor-pointer bg-transparent border-t border-[#404040] border-x-0 border-b-0"
            onClick={() => {
              reviewInfo.onResolveAll();
              setShow(false);
            }}
          >
            <CheckCheck size={12} />
            Resolve all
          </button>
        </div>
      )}
    </div>
  );
}
