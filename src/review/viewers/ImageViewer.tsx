export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex-1 flex items-center justify-center overflow-auto p-4">
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
