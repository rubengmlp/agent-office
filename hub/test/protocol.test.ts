import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { realPath } from '../src/floors';
import { taskLine } from '../src/office';
import { docRef, normalizeLesson, parseProtocol } from '../src/protocol';
import { tempDir } from './helpers';

describe('protocol messages', () => {
  test('each prefix is recognised with its path, round and score', () => {
    expect(parseProtocol('REVISAR: redaccion/planes/login.md ronda 2')).toMatchObject({
      kind: 'review',
      target: 'redaccion/planes/login.md',
      round: 2,
      score: null,
    });
    expect(parseProtocol('MEJORAR: redaccion/planes/login.md ronda 1 — nota 6/10\n1. bloqueante: falta X\n2. menor: Y')).toMatchObject({
      kind: 'improve',
      target: 'redaccion/planes/login.md',
      round: 1,
      score: 6,
    });
    expect(parseProtocol('APROBADO: `taller/skills/pdf-tools` ronda 3 — nota 8,5/10 — listo')).toMatchObject({
      kind: 'approved',
      target: 'taller/skills/pdf-tools',
      round: 3,
      score: 8.5,
    });
    expect(parseProtocol('SIN ACUERDO: redaccion/planes/x.md ronda 4 — quedan 2')).toMatchObject({ kind: 'no-agreement', round: 4 });
    expect(parseProtocol('HECHO: redaccion/planes/x.md aprobado en 2 rondas — resumen')).toMatchObject({
      kind: 'done',
      target: 'redaccion/planes/x.md',
      round: null,
    });
    expect(parseProtocol('Lección: no uses pumpAndSettle')).toMatchObject({ kind: 'lesson', target: null, rest: 'no uses pumpAndSettle' });
    expect(parseProtocol('LECCION: sin tilde también')).toMatchObject({ kind: 'lesson' });
    expect(parseProtocol('BLOQUEADO: falta el contrato')).toMatchObject({ kind: 'blocked', target: null });
    expect(parseProtocol('Te paso el plan para REVISAR: x')).toBeNull();
  });

  test('PARTIR carries the plan path and its phases, and a lead never takes it as a task', () => {
    expect(parseProtocol('PARTIR: redaccion/planes/login.md — fases: 1. backend\n2. mobile')).toMatchObject({
      kind: 'split',
      target: 'redaccion/planes/login.md',
      round: null,
      rest: 'redaccion/planes/login.md — fases: 1. backend\n2. mobile',
    });
    expect(parseProtocol('partir: `redaccion/planes/x.md` — fases: una')).toMatchObject({ kind: 'split', target: 'redaccion/planes/x.md' });
    expect(parseProtocol('Hay que PARTIR: redaccion/planes/x.md')).toBeNull();
    expect(taskLine('PARTIR: redaccion/planes/login.md — fases: backend | mobile')).toBeNull();
  });

  test('PLAN carries the plan path, PREGUNTA has no target and both are case sensitive', () => {
    expect(parseProtocol('PLAN: redaccion/planes/login.md — resumen en cinco líneas — léelo y espera la orden')).toMatchObject({
      kind: 'plan',
      target: 'redaccion/planes/login.md',
    });
    expect(parseProtocol('PREGUNTA: ¿Apple o Google primero? — opciones: Apple | Google')).toMatchObject({ kind: 'question', target: null });
    expect(parseProtocol('Plan: primero el login y después el registro')).toBeNull();
    expect(parseProtocol('pregunta: ¿seguro?')).toBeNull();
  });

  test('document paths are normalised to the documents repository', () => {
    const { dir, cleanup } = tempDir();
    const docs = realPath(join(dir, 'docs'));
    mkdirSync(join(docs, 'redaccion', 'planes'), { recursive: true });
    mkdirSync(join(docs, 'taller', 'skills', 'pdf-tools', 'scripts'), { recursive: true });
    expect(docRef('redaccion/planes/login.md', docs, null)).toEqual({ path: 'redaccion/planes/login.md', kind: 'plan', slug: 'login' });
    expect(docRef('./redaccion/planes/login.md', docs, null)?.path).toBe('redaccion/planes/login.md');
    expect(docRef(join(docs, 'redaccion', 'planes', 'login.md'), docs, null)?.slug).toBe('login');
    expect(docRef('planes/login.md', docs, join(docs, 'redaccion'))?.path).toBe('redaccion/planes/login.md');
    expect(docRef('taller/skills/pdf-tools/scripts/run.sh', docs, null)).toEqual({ path: 'taller/skills/pdf-tools', kind: 'skill', slug: 'pdf-tools' });
    expect(docRef('skills/pdf-tools', docs, join(docs, 'taller'))?.path).toBe('taller/skills/pdf-tools');
    expect(docRef('redaccion/planes/../../secret.md', docs, null)).toBeNull();
    expect(docRef('redaccion/.fuentes/login/mobile/README.md', docs, null)).toBeNull();
    expect(docRef('redaccion/historial/login.md', docs, null)).toBeNull();
    expect(docRef('/etc/passwd', docs, null)).toBeNull();
    expect(docRef('Implementada', docs, null)).toBeNull();
    expect(docRef('redaccion/planes/login.md', null, null)).toBeNull();
    cleanup();
  });

  test('lessons are normalised for duplicate detection', () => {
    expect(normalizeLesson('  No uses   pumpAndSettle.  ')).toBe(normalizeLesson('no uses pumpandsettle'));
    expect(normalizeLesson('Migración rota')).toBe('migracion rota');
  });
});
