/** Yields the `data` of each server-sent event, joining multi-line data the way the spec does. */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.search(/\r?\n/);
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(buffer[newline] === "\r" ? newline + 2 : newline + 1);
        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
        }
        newline = buffer.search(/\r?\n/);
      }
      if (done) break;
    }
    if (buffer.startsWith("data:")) data.push(buffer.slice(buffer.startsWith("data: ") ? 6 : 5));
    if (data.length) yield data.join("\n");
  } finally {
    reader.releaseLock();
  }
}
