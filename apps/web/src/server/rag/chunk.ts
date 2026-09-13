/** Overlapping word-based chunking with metadata. ~600 chars target. */
export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

export function chunkText(input: string, targetChars = 600, overlapChars = 80): Chunk[] {
  const text = input.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!text) return [];
  // split on paragraph/sentence boundaries first
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = "";
  const flush = () => {
    const c = current.trim();
    if (c) chunks.push({ index: chunks.length, content: c, tokenCount: Math.ceil(c.length / 4) });
    current = "";
  };
  for (const para of paras) {
    if ((current + "\n\n" + para).length <= targetChars + 200) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        // overlap: carry tail
        const tail = current.slice(-overlapChars);
        flush();
        current = tail + "\n" + para;
        if (current.length > targetChars + 400) {
          // hard split long para
          for (let i = 0; i < para.length; i += targetChars) {
            const slice = para.slice(Math.max(0, i - (i > 0 ? overlapChars : 0)), i + targetChars);
            chunks.push({ index: chunks.length, content: slice.trim(), tokenCount: Math.ceil(slice.length / 4) });
          }
          current = "";
        }
      } else {
        for (let i = 0; i < para.length; i += targetChars) {
          const slice = para.slice(Math.max(0, i - (i > 0 ? overlapChars : 0)), i + targetChars);
          chunks.push({ index: chunks.length, content: slice.trim(), tokenCount: Math.ceil(slice.length / 4) });
        }
      }
    }
  }
  flush();
  return chunks.filter((c) => c.content.length > 0);
}
