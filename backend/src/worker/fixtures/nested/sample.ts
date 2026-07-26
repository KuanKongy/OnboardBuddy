// Fixture for the two shapes the parser used to measure as nothing:
//   1. a handler declared inside another function's body, handed to something
//      else to invoke (no module-scope binding, no export, no call site here);
//   2. a class method that advances the object's own field (no data client,
//      no module-scope binding).

export function Panel(install: (fn: (next: number) => number) => void): number {
  let count = 0;
  const applyChange = (next: number): number => {
    count = next;
    return count;
  };
  // Declared but never handed anywhere and never called: dead code, not a handler.
  const unreferenced = (): number => count + 1;
  install(applyChange);
  return count;
}

export class Store {
  private items: number[] = [];

  advance(n: number): void {
    this.items.push(n);
  }
}
