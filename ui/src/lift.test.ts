import { describe, expect, test } from 'bun:test';
import { LiftController, linkLift, type LiftEvent, type LiftPhase, type LiftRider } from './lift';

const OPTIONS = { speed: 10, doorTime: 0.2, dwell: 0.3, maxDwell: 1 };
const DT = 0.05;

function stops(entries: [string, number][]): Map<string, number> {
  return new Map(entries);
}

function lift(home = 'c'): LiftController {
  const controller = new LiftController(OPTIONS);
  controller.setStops(stops([['a', 0], ['b', 20], ['c', 40]]), home);
  return controller;
}

function rider(key: string, from: string, to: string, extra: Partial<LiftRider> = {}): LiftRider {
  return { key, from, to, fromFace: 'room', toFace: 'room', ...extra };
}

type Log = { events: LiftEvent[]; phases: LiftPhase[]; positions: number[] };

function run(controller: LiftController, seconds: number, onEvent: (event: LiftEvent) => void = () => {}, log?: Log): Log {
  const out = log ?? { events: [], phases: [], positions: [] };
  for (let time = 0; time < seconds; time += DT) {
    for (const event of controller.tick(DT)) {
      out.events.push(event);
      onEvent(event);
    }
    if (out.phases.at(-1) !== controller.phase) out.phases.push(controller.phase);
    out.positions.push(controller.position);
  }
  return out;
}

function until(controller: LiftController, wanted: (event: LiftEvent) => boolean, limit = 20): LiftEvent[] {
  const seen: LiftEvent[] = [];
  for (let time = 0; time < limit; time += DT) {
    const events = controller.tick(DT);
    seen.push(...events);
    if (events.some(wanted)) return seen;
  }
  throw new Error('event never came');
}

describe('LiftController', () => {
  test('(a) one rider from a to b: fetch, board, close, ride, open, arrive', () => {
    const controller = lift('c');
    expect(controller.position).toBe(40);
    expect(controller.phase).toBe('idle');
    controller.request(rider('r1', 'a', 'b'));
    const log = run(controller, 12, (event) => {
      if (event.type === 'boarded') controller.aboard(event.key);
    });
    expect(log.events).toEqual([
      { type: 'boarded', key: 'r1' },
      { type: 'arrived', key: 'r1' },
    ]);
    expect(log.phases).toEqual(['moving', 'opening', 'open', 'closing', 'moving', 'opening', 'open', 'closing', 'idle']);
    const down = log.positions.slice(0, log.positions.indexOf(0) + 1);
    for (let index = 1; index < down.length; index += 1) expect(down[index]!).toBeLessThanOrEqual(down[index - 1]!);
    for (const position of log.positions) {
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(40);
    }
    expect(controller.position).toBe(20);
    expect(controller.at).toBe('b');
    expect(controller.doors).toBe(0);
  });

  test('(b) riders on different floors are served first come, first served', () => {
    const controller = lift('b');
    controller.request(rider('r1', 'c', 'a'));
    controller.request(rider('r2', 'a', 'c'));
    const log = run(controller, 30, (event) => {
      if (event.type === 'boarded') controller.aboard(event.key);
    });
    expect(log.events.map((event) => `${event.type}:${event.key}`)).toEqual([
      'boarded:r1',
      'arrived:r1',
      'boarded:r2',
      'arrived:r2',
    ]);
  });

  test('(c) a rider at the open stop boards in the same tick', () => {
    const controller = lift('c');
    controller.request(rider('r1', 'c', 'a'));
    until(controller, (event) => event.type === 'boarded');
    expect(controller.phase).toBe('open');
    controller.request(rider('r2', 'c', 'b'));
    expect(controller.tick(DT)).toEqual([{ type: 'boarded', key: 'r2' }]);
  });

  test('(d) cancelling a waiting rider leaves the cabin where it is', () => {
    const controller = lift('c');
    controller.request(rider('r1', 'a', 'b'));
    controller.cancel('r1');
    const log = run(controller, 3);
    expect(log.events).toEqual([]);
    expect(controller.position).toBe(40);
    expect(controller.phase).toBe('idle');
  });

  test('(e) new stops move a parked cabin with its stop', () => {
    const controller = lift('c');
    controller.setStops(stops([['a', 0], ['b', 20], ['c', 55]]));
    expect(controller.position).toBe(55);
    expect(controller.at).toBe('c');
  });

  test('(f) a stop that disappears cancels its riders', () => {
    const controller = lift('c');
    controller.request(rider('r1', 'a', 'b'));
    controller.request(rider('r2', 'c', 'a'));
    controller.setStops(stops([['a', 0], ['c', 40]]));
    expect(controller.tick(DT)).toContainEqual({ type: 'cancelled', key: 'r1' });
    const log = run(controller, 10, (event) => {
      if (event.type === 'boarded') controller.aboard(event.key);
    });
    expect(log.events.map((event) => `${event.type}:${event.key}`)).toEqual(['boarded:r2', 'arrived:r2']);
  });

  test('(g) a rider who never steps in is cancelled and the next one is served', () => {
    const controller = lift('c');
    controller.request(rider('slow', 'c', 'a'));
    controller.request(rider('next', 'a', 'b'));
    const log = run(controller, 15, (event) => {
      if (event.type === 'boarded' && event.key === 'next') controller.aboard(event.key);
    });
    expect(log.events.map((event) => `${event.type}:${event.key}`)).toEqual([
      'boarded:slow',
      'cancelled:slow',
      'boarded:next',
      'arrived:next',
    ]);
    expect(controller.at).toBe('b');
  });

  test('(h) two stops on one level: arriving at the second means stopping at the first', () => {
    const controller = new LiftController(OPTIONS);
    controller.setStops(stops([['ground', 0], ['street', 0], ['top', 30]]), 'top');
    controller.request(rider('r1', 'top', 'street', { toFace: 'street' }));
    let arrivedAt: number | null = null;
    run(controller, 10, (event) => {
      if (event.type === 'boarded') controller.aboard(event.key);
      if (event.type === 'arrived') arrivedAt = controller.position;
    });
    expect(arrivedAt).not.toBeNull();
    expect(arrivedAt!).toBe(0);
  });

  test('(i) cancelling a rider inside sends the cabin to the next destination', () => {
    const controller = lift('a');
    controller.request(rider('r1', 'a', 'c'));
    controller.request(rider('r2', 'a', 'b'));
    until(controller, (event) => event.type === 'boarded');
    controller.aboard('r1');
    controller.aboard('r2');
    controller.cancel('r1');
    const events = until(controller, (event) => event.type === 'arrived');
    expect(events.filter((event) => event.type === 'arrived')).toEqual([{ type: 'arrived', key: 'r2' }]);
    expect(controller.at).toBe('b');
  });

  test('(j) served faces: street out and bridge in at the same level, cleared after closing', () => {
    const controller = new LiftController(OPTIONS);
    controller.setStops(stops([['ground', 0], ['street', 0], ['top', 30]]), 'top');
    controller.request(rider('out', 'top', 'street', { toFace: 'street' }));
    until(controller, (event) => event.type === 'boarded');
    controller.aboard('out');
    controller.request(rider('in', 'ground', 'top', { fromFace: 'bridge' }));
    until(controller, (event) => event.type === 'arrived');
    expect(controller.servedFaces()).toEqual(['street', 'bridge']);
    controller.aboard('in');
    for (let index = 0; index < 100 && controller.phase !== 'moving'; index += 1) controller.tick(DT);
    expect(controller.phase).toBe('moving');
    expect(controller.servedFaces()).toEqual([]);
  });
});

describe('linkLift', () => {
  test('hands each rider its own events, one at a time', () => {
    const controller = lift('a');
    const link = linkLift(controller, { serves: () => true, landing: () => 0, cabin: () => 0 });
    link.request(rider('r1', 'a', 'b'));
    link.deliver(until(controller, (event) => event.type === 'boarded'));
    expect(link.take('other')).toBeNull();
    expect(link.take('r1')).toEqual({ type: 'boarded', key: 'r1' });
    expect(link.take('r1')).toBeNull();
    link.deliver([{ type: 'arrived', key: 'r1' }]);
    link.cancel('r1');
    expect(link.take('r1')).toBeNull();
  });
});
