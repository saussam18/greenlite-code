import { useState, useEffect, useRef } from "react";
import type { ChangedFile } from "../../types/git";

function statusColor(status: string) {
  switch (status) {
    case "M": return "text-[#dcdcaa]";
    case "A": return "text-[#6a9955]";
    case "D": return "text-[#f44747]";
    default: return "text-[#d4d4d4]";
  }
}

interface ChangedFilesPopoverProps {
  files: ChangedFile[];
}

export function ChangedFilesPopover({ files }: ChangedFilesPopoverProps) {
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

  if (files.length === 0) {
    return <span className="text-[#555]">No changes</span>;
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center gap-2 text-[14px] text-[#888] hover:text-[#ccc] cursor-pointer bg-transparent border-none font-mono"
        onClick={() => setShow(!show)}
      >
        {(() => {
          const counts: Record<string, number> = {};
          for (const f of files) {
            counts[f.status] = (counts[f.status] || 0) + 1;
          }
          return Object.entries(counts).map(([label, count]) => (
            <span key={label} className="flex items-center gap-0.5">
              <span className={`font-bold ${statusColor(label)}`}>{label}</span>
              <span>{count}</span>
            </span>
          ));
        })()}
        <span className="text-[#555]">({files.length})</span>
      </button>

      {show && (
        <div className="absolute bottom-full right-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] max-h-[400px] w-[400px] overflow-y-auto z-50">
          <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
            Changed Files ({files.length})
          </div>
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-[7px] text-[14px] hover:bg-white/[0.05]"
              title={f.path}
            >
              <span className={`font-mono font-bold w-[22px] text-center shrink-0 ${statusColor(f.status)}`}>
                {f.status}
              </span>
              <span className="text-[#d4d4d4] truncate min-w-0">{f.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
