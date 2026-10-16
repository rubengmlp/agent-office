export type LiftFace = 'room' | 'street' | 'bridge';

export type LiftRider = { key: string; from: string; to: string; fromFace: LiftFace; toFace: LiftFace };

export type LiftEvent =
  | { type: 'boarded'; key: string }
  | { type: 'arrived'; key: string }
  | { type: 'cancelled'; key: string };

export type LiftPhase = 'idle' | 'moving' | 'opening' | 'open' | 'closing';

export type LiftOptions = { speed: number; doorTime: number; dwell: number; maxDwell: number };

export type LiftService<P> = {
  serves(from: string, to: string): boolean;
  landing(floor: string, face: LiftFace): P;
  cabin(floor: string): P;
  request(rider: LiftRider): void;
  aboard(key: string): void;
  cancel(key: string): void;
  position(): number;
  take(key: string): LiftEvent | null;
};

type Entering = { rider: LiftRider; since: number };

type Detour = { dir: number; goal: number };

const SAME = 1e-6;

function same(a: number | undefined, b: number | undefined): boolean {
  return a !== undefined && b !== undefined && Math.abs(a - b) < SAME;
}

export class LiftController {
  private stops: ReadonlyMap<string, number> = new Map();
  private placed = false;
  private pos = 0;
  private door = 0;
  private stop: string | null = null;
  private state: LiftPhase = 'idle';
  private waiting: LiftRider[] = [];
  private entering: Entering[] = [];
  private inside: LiftRider[] = [];
  private faces: LiftFace[] = [];
  private openFor = 0;
  private detour: Detour | null = null;
  private pending: LiftEvent[] = [];

  constructor(private readonly options: LiftOptions) {}

  get position(): number {
    return this.pos;
  }

  get doors(): number {
    return this.door;
  }

  get at(): string | null {
    return this.stop;
  }

  get phase(): LiftPhase {
    return this.state;
  }

  get riders(): readonly string[] {
    return this.inside.map((rider) => rider.key);
  }

  servedFaces(): readonly LiftFace[] {
    return this.faces;
  }

  setStops(stops: ReadonlyMap<string, number>, home?: string): void {
    this.stops = new Map(stops);
    if (!this.placed && stops.size > 0) {
      this.placed = true;
      const start = (home !== undefined && stops.has(home) ? home : stops.keys().next().value) as string;
      this.pos = stops.get(start) ?? 0;
      this.stop = start;
    }
    if (this.stop !== null) {
      const here = stops.get(this.stop);
      if (here === undefined) this.stop = null;
      else if (this.state !== 'moving') this.pos = here;
    }
    const known = (slug: string): boolean => stops.has(slug);
    const drop = (rider: LiftRider): boolean => {
      if (known(rider.from) && known(rider.to)) return false;
      this.pending.push({ type: 'cancelled', key: rider.key });
      return true;
    };
    this.waiting = this.waiting.filter((rider) => !drop(rider));
    this.entering = this.entering.filter((entry) => !drop(entry.rider));
    this.inside = this.inside.filter((rider) => known(rider.to) || !drop(rider));
  }

  request(rider: LiftRider): void {
    this.cancel(rider.key);
    this.waiting.push({ ...rider });
  }

  aboard(key: string): void {
    const index = this.entering.findIndex((entry) => entry.rider.key === key);
    if (index < 0) return;
    const [entry] = this.entering.splice(index, 1);
    this.inside.push(entry.rider);
  }

  cancel(key: string): void {
    this.waiting = this.waiting.filter((rider) => rider.key !== key);
    this.entering = this.entering.filter((entry) => entry.rider.key !== key);
    this.inside = this.inside.filter((rider) => rider.key !== key);
  }

  tick(dt: number): LiftEvent[] {
    const events = this.pending;
    this.pending = [];
    const { speed, doorTime, dwell, maxDwell } = this.options;
    switch (this.state) {
      case 'idle':
      case 'moving':
        this.travel(speed * dt);
        break;
      case 'opening':
        this.door = Math.min(1, this.door + dt / doorTime);
        if (this.door >= 1) {
          this.state = 'open';
          this.openFor = 0;
          this.exchange(events);
        }
        break;
      case 'open': {
        this.openFor += dt;
        this.exchange(events);
        for (const entry of this.entering) entry.since += dt;
        const late = this.entering.filter((entry) => entry.since > maxDwell);
        for (const entry of late) events.push({ type: 'cancelled', key: entry.rider.key });
        if (late.length > 0) this.entering = this.entering.filter((entry) => entry.since <= maxDwell);
        if (this.entering.length === 0 && this.openFor >= dwell) this.state = 'closing';
        break;
      }
      case 'closing':
        this.door = Math.max(0, this.door - dt / doorTime);
        if (this.door <= 0) {
          this.state = 'idle';
          this.faces = [];
          this.detour = null;
          this.travel(0);
        }
        break;
    }
    return events;
  }

  private travel(step: number): void {
    const dest = this.destination();
    const goal = dest === null ? undefined : this.stops.get(dest);
    if (dest === null || goal === undefined) {
      this.state = 'idle';
      return;
    }
    const dir = Math.sign(goal - this.pos);
    const via = dir === 0 ? null : this.stopOnTheWay(dir, goal);
    if (via !== null && Math.abs(via.at - this.pos) <= step) {
      this.pos = via.at;
      this.stop = via.slug;
      this.detour = { dir, goal };
      this.state = 'opening';
    } else if (Math.abs(goal - this.pos) <= step) {
      this.pos = goal;
      this.stop = dest;
      this.state = 'opening';
    } else {
      this.pos += Math.sign(goal - this.pos) * step;
      this.stop = null;
      this.state = 'moving';
    }
  }

  private stopOnTheWay(dir: number, goal: number): { slug: string; at: number } | null {
    const slugs = [
      ...this.inside.map((rider) => rider.to),
      ...this.waiting.filter((rider) => this.alongside(rider, dir, goal)).map((rider) => rider.from),
    ];
    let best: { slug: string; at: number } | null = null;
    for (const slug of slugs) {
      const at = this.stops.get(slug);
      if (at === undefined || (at - this.pos) * dir <= SAME || (goal - at) * dir <= SAME) continue;
      if (!best || (at - best.at) * dir < 0) best = { slug, at };
    }
    return best;
  }

  private alongside(rider: LiftRider, dir: number, goal: number): boolean {
    const from = this.stops.get(rider.from);
    const to = this.stops.get(rider.to);
    if (from === undefined || to === undefined || Math.sign(to - from) !== dir) return false;
    return (goal - to) * dir >= -SAME;
  }

  private here(): number | undefined {
    return this.stop === null ? undefined : this.stops.get(this.stop);
  }

  private destination(): string | null {
    if (this.inside.length > 0) return this.inside[0].to;
    if (this.waiting.length > 0) return this.waiting[0].from;
    return null;
  }

  private serve(face: LiftFace): void {
    if (!this.faces.includes(face)) this.faces.push(face);
  }

  private exchange(events: LiftEvent[]): void {
    const here = this.here();
    if (here === undefined) return;
    this.inside = this.inside.filter((rider) => {
      if (!same(this.stops.get(rider.to), here)) return true;
      events.push({ type: 'arrived', key: rider.key });
      this.serve(rider.toFace);
      return false;
    });
    const detour = this.detour;
    this.waiting = this.waiting.filter((rider) => {
      if (!same(this.stops.get(rider.from), here)) return true;
      if (detour && !this.alongside(rider, detour.dir, detour.goal)) return true;
      events.push({ type: 'boarded', key: rider.key });
      this.serve(rider.fromFace);
      this.entering.push({ rider, since: 0 });
      return false;
    });
  }
}

export type LiftPlaces<P> = {
  serves(from: string, to: string): boolean;
  landing(floor: string, face: LiftFace): P;
  cabin(floor: string): P;
};

export type LiftLink<P> = LiftService<P> & { deliver(events: readonly LiftEvent[]): void; clear(): void };

export function linkLift<P>(controller: LiftController, places: LiftPlaces<P>): LiftLink<P> {
  const inbox = new Map<string, LiftEvent[]>();
  return {
    serves: (from, to) => places.serves(from, to),
    landing: (floor, face) => places.landing(floor, face),
    cabin: (floor) => places.cabin(floor),
    request: (rider) => {
      inbox.delete(rider.key);
      controller.request(rider);
    },
    aboard: (key) => controller.aboard(key),
    cancel: (key) => {
      inbox.delete(key);
      controller.cancel(key);
    },
    position: () => controller.position,
    take: (key) => {
      const queue = inbox.get(key);
      const event = queue?.shift() ?? null;
      if (queue && queue.length === 0) inbox.delete(key);
      return event;
    },
    deliver: (events) => {
      for (const event of events) {
        const queue = inbox.get(event.key) ?? [];
        queue.push(event);
        inbox.set(event.key, queue);
      }
    },
    clear: () => inbox.clear(),
  };
}
