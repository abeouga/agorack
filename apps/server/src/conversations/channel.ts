/**
 * 書く側が push した値を、読む側が for await で順に受け取る通り道。
 * 読む側が途中でやめたら onCancel を呼ぶ。
 */
export type Channel<T> = {
  push(value: T): void;
  close(): void;
  readonly iterable: AsyncIterable<T>;
};

export function createChannel<T>(onCancel: () => void): Channel<T> {
  const buffer: T[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  async function* read(): AsyncGenerator<T> {
    let finished = false;
    try {
      for (;;) {
        const value = buffer.shift();
        if (value !== undefined) {
          yield value;
          continue;
        }
        if (closed) {
          finished = true;
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      if (!finished) onCancel();
    }
  }

  return {
    push(value) {
      if (closed) return;
      buffer.push(value);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    iterable: { [Symbol.asyncIterator]: read },
  };
}
