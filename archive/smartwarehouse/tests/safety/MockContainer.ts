export class MockItemStack {
  readonly maxAmount = 64;

  constructor(
    readonly typeId: string,
    public amount: number
  ) {}

  clone(): MockItemStack {
    return new MockItemStack(this.typeId, this.amount);
  }

  isStackableWith(other: MockItemStack): boolean {
    return this.typeId === other.typeId;
  }
}

export class MockContainer {
  failSetSlots = new Set<number>();

  constructor(
    readonly size: number,
    private readonly slots: (MockItemStack | undefined)[] = []
  ) {
    while (this.slots.length < size) this.slots.push(undefined);
  }

  getItem(slot: number): MockItemStack | undefined {
    return this.slots[slot]?.clone();
  }

  setItem(slot: number, item?: MockItemStack): void {
    if (this.failSetSlots.has(slot)) throw new Error(`setItem failed at slot ${slot}`);
    this.slots[slot] = item?.clone();
  }

  addItem(item: MockItemStack): MockItemStack | undefined {
    let remaining = item.amount;
    for (let slot = 0; slot < this.size; slot++) {
      const existing = this.slots[slot];
      if (!existing || existing.typeId !== item.typeId || existing.amount >= existing.maxAmount) continue;
      const moved = Math.min(remaining, existing.maxAmount - existing.amount);
      this.slots[slot] = new MockItemStack(existing.typeId, existing.amount + moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }
    for (let slot = 0; slot < this.size; slot++) {
      if (this.slots[slot]) continue;
      const moved = Math.min(remaining, item.maxAmount);
      this.slots[slot] = new MockItemStack(item.typeId, moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }
    return new MockItemStack(item.typeId, remaining);
  }
}
