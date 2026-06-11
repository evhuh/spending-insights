import "@testing-library/jest-dom/vitest";

// The jsdom environment under Node 25 exposes a non-functional localStorage
// (Node's experimental global shadows jsdom's). Provide a real in-memory one.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
  });
}
