import { hashString } from './office/palette';

export type CarState = 'parked' | 'leaving' | 'away' | 'arriving';

export type Car = { bay: number; state: CarState; progress: number; seed: number };

export type ParkingOptions = { leaveTime: number; returnAfter: number; quickReturn: number; arriveTime: number };

type Bay = { car: Car; queue: string[]; awayFor: number };

export class ParkingLot {
  private bays: Bay[] = [];
  private readonly reservations = new Map<string, number>();
  private readonly departed = new Set<string>();
  private carCount = 0;

  constructor(
    bays: number,
    private readonly options: ParkingOptions,
  ) {
    this.resize(bays);
  }

  get cars(): readonly Car[] {
    return this.bays.map((bay) => bay.car);
  }

  get size(): number {
    return this.bays.length;
  }

  resize(bays: number): void {
    const count = Math.max(1, Math.floor(bays));
    if (count === this.bays.length) return;
    while (this.bays.length < count) {
      const bay = this.bays.length;
      this.bays.push({ car: { bay, state: 'parked', progress: 0, seed: this.nextSeed() }, queue: [], awayFor: 0 });
    }
    if (this.bays.length > count) {
      const removed = this.bays.splice(count);
      for (const [key, bay] of this.reservations) {
        if (bay < count) continue;
        const target = this.leastReserved(hashString(key));
        this.reservations.set(key, target);
        const queue = removed[bay - count].queue;
        if (queue.includes(key)) this.bays[target].queue.push(key);
      }
    }
  }

  reserve(key: string): number {
    const known = this.reservations.get(key);
    if (known !== undefined) return known;
    const bay = this.leastReserved(hashString(key));
    this.reservations.set(key, bay);
    return bay;
  }

  release(key: string): void {
    const bay = this.reservations.get(key);
    this.reservations.delete(key);
    this.departed.delete(key);
    if (bay === undefined) return;
    const slot = this.bays[bay];
    if (slot) slot.queue = slot.queue.filter((item) => item !== key);
  }

  bayOf(key: string): number | null {
    return this.reservations.get(key) ?? null;
  }

  carReady(bay: number): boolean {
    return this.bays[bay]?.car.state === 'parked';
  }

  depart(key: string): void {
    const bay = this.reserve(key);
    const slot = this.bays[bay];
    if (this.departed.has(key) || slot.queue.includes(key)) return;
    slot.queue.push(key);
  }

  boarding(key: string): boolean {
    const bay = this.reservations.get(key);
    return bay !== undefined && this.bays[bay].queue.includes(key);
  }

  tick(dt: number): void {
    const { leaveTime, returnAfter, quickReturn, arriveTime } = this.options;
    for (const slot of this.bays) {
      const car = slot.car;
      switch (car.state) {
        case 'parked': {
          const key = slot.queue.shift();
          if (key === undefined) break;
          this.departed.add(key);
          car.state = 'leaving';
          car.progress = 0;
          break;
        }
        case 'leaving':
          car.progress = Math.min(1, car.progress + dt / leaveTime);
          if (car.progress >= 1) {
            car.state = 'away';
            car.progress = 0;
            slot.awayFor = 0;
          }
          break;
        case 'away':
          slot.awayFor += dt;
          if (slot.awayFor >= (slot.queue.length > 0 ? quickReturn : returnAfter)) {
            car.state = 'arriving';
            car.progress = 0;
            car.seed = this.nextSeed();
          }
          break;
        case 'arriving':
          car.progress = Math.min(1, car.progress + dt / arriveTime);
          if (car.progress >= 1) {
            car.state = 'parked';
            car.progress = 0;
          }
          break;
      }
    }
  }

  private nextSeed(): number {
    this.carCount += 1;
    return hashString(`car-${this.carCount}`);
  }

  private leastReserved(hash: number): number {
    const counts = this.bays.map(() => 0);
    for (const bay of this.reservations.values()) if (bay < counts.length) counts[bay] += 1;
    const total = counts.length;
    let best = hash % total;
    for (let step = 0; step < total; step += 1) {
      const bay = (hash + step) % total;
      if (counts[bay] < counts[best]) best = bay;
    }
    return best;
  }
}
