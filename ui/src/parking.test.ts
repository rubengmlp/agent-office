import { describe, expect, test } from 'bun:test';
import { ParkingLot, type CarState } from './parking';

const OPTIONS = { leaveTime: 2, returnAfter: 6, quickReturn: 1.5, arriveTime: 2 };
const DT = 0.1;

function lot(bays = 3): ParkingLot {
  return new ParkingLot(bays, OPTIONS);
}

function tickFor(parking: ParkingLot, seconds: number, onTick: () => void = () => {}): void {
  for (let time = 0; time < seconds - 1e-9; time += DT) {
    parking.tick(DT);
    onTick();
  }
}

function stateOf(parking: ParkingLot, bay: number): CarState {
  return parking.cars[bay]!.state;
}

describe('ParkingLot', () => {
  test('(a) a reservation stays put through departure and while the car is away', () => {
    const parking = lot();
    const bay = parking.reserve('a');
    expect(parking.reserve('a')).toBe(bay);
    parking.depart('a');
    expect(parking.reserve('a')).toBe(bay);
    parking.tick(DT);
    expect(stateOf(parking, bay)).toBe('leaving');
    expect(parking.reserve('a')).toBe(bay);
    tickFor(parking, 2.5);
    expect(stateOf(parking, bay)).toBe('away');
    expect(parking.reserve('a')).toBe(bay);
    expect(parking.bayOf('a')).toBe(bay);
  });

  test('(b) agents get bays of their own while there are free ones', () => {
    const parking = lot(4);
    const bays = ['a', 'b', 'c', 'd'].map((key) => parking.reserve(key));
    expect(new Set(bays).size).toBe(4);
  });

  test('(c) leaving while the car is away waits for it to come back', () => {
    const parking = lot(1);
    parking.depart('a');
    parking.tick(DT);
    tickFor(parking, 2.5);
    expect(stateOf(parking, 0)).toBe('away');
    parking.depart('b');
    expect(parking.boarding('b')).toBe(true);
    let leftAt: number | null = null;
    let time = 0;
    tickFor(parking, 10, () => {
      time += DT;
      if (leftAt === null && stateOf(parking, 0) === 'leaving') leftAt = time;
    });
    expect(leftAt).not.toBeNull();
    expect(parking.boarding('b')).toBe(false);
  });

  test('(d) releasing a reservation frees the bay for someone else', () => {
    const parking = lot(2);
    const first = parking.reserve('a');
    const second = parking.reserve('b');
    expect(first).not.toBe(second);
    parking.release('a');
    expect(parking.bayOf('a')).toBeNull();
    expect(parking.reserve('c')).toBe(first);
  });

  test('(d) releasing also drops a queued departure', () => {
    const parking = lot(1);
    parking.depart('a');
    parking.tick(DT);
    parking.depart('b');
    parking.release('b');
    tickFor(parking, 20);
    expect(stateOf(parking, 0)).toBe('parked');
  });

  test('(e) leaving, away, arriving and parked take their times; a queue brings the car back sooner', () => {
    const parking = lot(1);
    parking.depart('a');
    const seed = parking.cars[0]!.seed;
    parking.tick(DT);
    tickFor(parking, 1.9);
    expect(stateOf(parking, 0)).toBe('leaving');
    tickFor(parking, 0.2);
    expect(stateOf(parking, 0)).toBe('away');
    tickFor(parking, 5.8);
    expect(stateOf(parking, 0)).toBe('away');
    tickFor(parking, 0.3);
    expect(stateOf(parking, 0)).toBe('arriving');
    expect(parking.cars[0]!.seed).not.toBe(seed);
    tickFor(parking, 2.1);
    expect(stateOf(parking, 0)).toBe('parked');

    parking.depart('b');
    parking.tick(DT);
    tickFor(parking, 2.1);
    expect(stateOf(parking, 0)).toBe('away');
    parking.depart('c');
    tickFor(parking, 1.6);
    expect(stateOf(parking, 0)).toBe('arriving');
  });

  test('(f) boarding ends with the tick the car leaves, or waits for the car to come back', () => {
    const parking = lot(1);
    parking.depart('a');
    expect(parking.boarding('a')).toBe(true);
    parking.tick(DT);
    expect(parking.boarding('a')).toBe(false);
    parking.depart('a');
    expect(parking.boarding('a')).toBe(false);

    parking.depart('b');
    expect(parking.boarding('b')).toBe(true);
    tickFor(parking, 2.1);
    expect(stateOf(parking, 0)).toBe('away');
    expect(parking.boarding('b')).toBe(true);
    let waiting = 0;
    tickFor(parking, 10, () => {
      if (parking.boarding('b')) waiting += 1;
    });
    expect(waiting).toBeGreaterThan(0);
    expect(parking.boarding('b')).toBe(false);
  });

  test('(g) more agents than bays: everyone gets one, at most two per bay, and everyone leaves', () => {
    const bays = 3;
    const parking = lot(bays);
    const keys = ['a', 'b', 'c', 'd', 'e'];
    for (const key of keys) parking.reserve(key);
    const perBay = new Map<number, number>();
    for (const key of keys) {
      const bay = parking.bayOf(key);
      expect(bay).not.toBeNull();
      perBay.set(bay!, (perBay.get(bay!) ?? 0) + 1);
    }
    expect(Math.max(...perBay.values())).toBeLessThanOrEqual(2);
    for (const key of keys) parking.depart(key);
    let departures = 0;
    let previous = parking.cars.map((car) => car.state);
    tickFor(parking, 30, () => {
      const now = parking.cars.map((car) => car.state);
      now.forEach((state, bay) => {
        if (state === 'leaving' && previous[bay] !== 'leaving') departures += 1;
      });
      previous = now;
    });
    expect(departures).toBe(keys.length);
    for (const key of keys) expect(parking.boarding(key)).toBe(false);
  });

  test('a smaller lot moves reservations from the removed bays', () => {
    const parking = lot(4);
    for (const key of ['a', 'b', 'c', 'd']) parking.reserve(key);
    parking.resize(2);
    expect(parking.cars).toHaveLength(2);
    for (const key of ['a', 'b', 'c', 'd']) expect(parking.bayOf(key)!).toBeLessThan(2);
  });
});
