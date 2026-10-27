/** One promise chain per key: jobs for the same key run one at a time in call order, different keys in parallel. */
export class KeyedSerial {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // `previous` is a settled-or-pending tail that never rejects, so a failed job cannot block the key.
    const result = previous.then(fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
