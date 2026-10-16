import { globMatches } from './glob';
import type { GateMode } from './types';

export type GateFacts = {
  officeTeam: boolean;
  floorManaged: boolean;
  owner: string | null;
  lastOwnerEdit: number | null;
  lastTesterGreen: number | null;
  changed: string[];
  changedTotal?: number;
  fingerprintPending: boolean;
};

export type GateDecision = { pass: boolean; reason: string };

const LISTED_FILES = 8;

function changedList(f: GateFacts): string {
  if (f.changed.length === 0) return '';
  const shown = f.changed.slice(0, LISTED_FILES);
  const more = Math.max(f.changedTotal ?? f.changed.length, f.changed.length) - shown.length;
  return ` Ficheros cambiados sin tester: ${shown.join(', ')}${more > 0 ? ` (y ${more} más)` : ''}.`;
}

export function decideGate(f: GateFacts): GateDecision {
  if (!f.officeTeam || !f.floorManaged) return { pass: true, reason: 'fuera de la oficina' };
  if (f.fingerprintPending) {
    return { pass: false, reason: 'La huella de cambios del desarrollador aún se está calculando; vuelve a intentarlo en unos segundos.' };
  }
  if (f.lastOwnerEdit === null) return { pass: true, reason: 'sin cambios en el repositorio' };
  if (f.lastTesterGreen !== null && f.lastTesterGreen > f.lastOwnerEdit) {
    return { pass: true, reason: 'tester en verde después del último cambio' };
  }
  const who = f.owner ? ` de ${f.owner}` : '';
  return {
    pass: false,
    reason: `Falta tester: no hay tests en verde de un tester de esta planta posteriores al último cambio${who}. Pide al tester que pruebe lo que cambió y vuelve a intentarlo. Un test del propio desarrollador no cuenta.${changedList(f)}`,
  };
}

export type DocumentGateFacts = {
  raw: string | null;
  path: string | null;
  changedAt: number | null;
  approvedAt: number | null;
};

export function decideDocumentGate(f: DocumentGateFacts): GateDecision {
  if (!f.path) {
    const seen = f.raw ? ` ("${f.raw}" no es la ruta de un plan ni de una skill)` : '';
    return {
      pass: false,
      reason: `Falta la ruta${seen}: el aviso de fin de un departamento empieza por la ruta del documento, relativa al repositorio de documentos. Ejemplos: "HECHO: redaccion/planes/<slug>.md aprobado en N rondas — …" o "HECHO: taller/skills/<nombre> aprobado en N rondas — …".`,
    };
  }
  if (f.changedAt === null) {
    return { pass: false, reason: `No encuentro ${f.path} en el repositorio de documentos. Revisa la ruta y vuelve a enviar el aviso.` };
  }
  if (f.approvedAt === null) {
    return {
      pass: false,
      reason: `Falta aprobación: ningún revisor ha enviado "APROBADO: ${f.path}". Pide la revisión de la ronda siguiente y vuelve a intentarlo.`,
    };
  }
  if (f.approvedAt <= f.changedAt) {
    return {
      pass: false,
      reason: `Falta aprobación: ${f.path} cambió después del último "APROBADO:". Cualquier cambio invalida la aprobación: pide una ronda más al revisor.`,
    };
  }
  return { pass: true, reason: 'aprobado después del último cambio' };
}

export function planByteLimit(maxBytes: number, floors: number, analysis: boolean): number {
  if (analysis) return maxBytes * 2;
  return Math.round(maxBytes * Math.min(2, 1 + 0.5 * (Math.max(1, floors) - 1)));
}

export type ReadCapFacts = { count: number; max: number; retired: boolean };

export function decideReadCap(f: ReadCapFacts): GateDecision {
  if (f.retired) return { pass: false, reason: 'Ya enviaste tu veredicto: no leas más y termina.' };
  if (f.max > 0 && f.count >= f.max) {
    return {
      pass: false,
      reason: `Límite de lecturas: llevas ${f.count} (review.maxReviewerReads). Emite ya tu veredicto con lo leído y marca como «sin comprobar» lo que no hayas podido verificar.`,
    };
  }
  return { pass: true, reason: 'lecturas dentro del tope' };
}

export function kilobytes(bytes: number): number {
  return Math.ceil(bytes / 1000);
}

export type ReviewGateFacts = {
  path: string | null;
  round: number | null;
  maxRounds: number;
  bytes: number | null;
  maxBytes: number;
  analysis: boolean;
  floors: number;
};

export type ReviewGateDecision = GateDecision & { cause: 'rounds' | 'size' | null };

export function decideReviewGate(f: ReviewGateFacts): ReviewGateDecision {
  if (f.round !== null && f.round > f.maxRounds) {
    return {
      pass: false,
      cause: 'rounds',
      reason: `Tope de rondas: ${f.path ?? 'el documento'} ya ha agotado sus ${f.maxRounds} rondas de revisión (review.maxRounds); la ronda ${f.round} no se abre. No repitas el REVISAR: escribe a tu jefe que se ha alcanzado el tope y espera su decisión. Un SIN ACUERDO: no abre más rondas: solo el usuario puede hacerlo, subiendo «Rondas máximas» en Ajustes.`,
    };
  }
  const limit = planByteLimit(f.maxBytes, f.floors, f.analysis);
  if (f.maxBytes <= 0 || f.bytes === null || f.bytes <= limit) return { pass: true, cause: null, reason: 'dentro de los topes de ronda y tamaño' };
  const max = kilobytes(limit);
  const why = f.analysis ? ', el doble por ser un análisis' : f.floors > 1 ? `, para ${f.floors} plantas` : '';
  return {
    pass: false,
    cause: 'size',
    reason: `Plan demasiado largo: ${f.path ?? 'el plan'} ocupa ${kilobytes(f.bytes)} KB y el tope es ${max} KB${why} (review.maxPlanBytes). Condénsalo a ${max} KB como mucho: quita lo que repite el código o tu exploración, cita símbolos en vez de ruta:línea fuera de Diseño y deja el historial en redaccion/historial/. Si tiene fases que se ejecutan por separado, pide a tu jefe partirlo con PARTIR:. Después repite el mismo REVISAR, con la misma ronda.`,
  };
}

export type RunFacts = {
  sha: string;
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  // The first check that did not pass.
  failed: { name: string; exitCode: number | null; timedOut: boolean } | null;
};

export type OrderGateFacts = {
  mode: GateMode;
  hasChecks: boolean;
  // HEAD of the folder; null when git could not say.
  head: string | null;
  // Files with changes nobody committed, after discounting the ones a checkpoint skipped and that have not changed.
  dirty: readonly string[];
  run: RunFacts | null;
  // For checks+tester: what the tester gate says about the same order.
  tester: GateDecision | null;
  // Files of the diff that change how the floor is checked.
  touched: readonly string[];
  forcedSha: string | null;
};

export type OrderGateDecision = GateDecision & { action: 'run-checks' | 'request-review' | null };

function short(sha: string): string {
  return sha.slice(0, 7);
}

// The gate of a HECHO that belongs to an order. Everything it needs has been read already: it decides, and says
// whether the hub should run the checks to get unstuck. mode tester is the old gate and is not decided here.
export function decideOrderGate(f: OrderGateFacts): OrderGateDecision {
  const pass = (reason: string): OrderGateDecision => ({ pass: true, reason, action: null });
  const block = (reason: string, action: OrderGateDecision['action'] = null): OrderGateDecision => ({ pass: false, reason, action });
  if (f.mode === 'tester') return pass('puerta del tester');
  if (!f.hasChecks) {
    return f.mode === 'checks+tester' && f.tester && !f.tester.pass ? block(f.tester.reason) : pass('esta planta no tiene comprobaciones configuradas');
  }
  if (f.head === null) return block('No he podido leer el estado de la carpeta del encargo: vuelve a intentarlo en unos segundos.');
  if (f.touched.length > 0 && f.forcedSha !== f.head) {
    return block(
      `El encargo cambia cómo se comprueba (${f.touched.join(', ')}): un verde sobre unas comprobaciones que el propio encargo modificó no vale. El usuario tiene que darlo por bueno en el Tablero; no repitas el HECHO hasta entonces.`,
    );
  }
  if (f.dirty.length > 0) {
    return block(`Hay cambios sin comprobar${f.run ? ` después de ${short(f.run.sha)}` : ''}: ${listed(f.dirty)}. La oficina lanza las comprobaciones; espera el aviso COMPROBACIONES y repite el HECHO.`, 'run-checks');
  }
  if (!f.run || f.run.status === 'cancelled' || f.run.sha !== f.head) {
    return block(
      `Hay cambios sin comprobar${f.run && f.run.status !== 'cancelled' ? ` después de ${short(f.run.sha)}` : ''}. La oficina lanza las comprobaciones; espera el aviso COMPROBACIONES y repite el HECHO.`,
      'run-checks',
    );
  }
  if (f.run.status === 'running') return block('Comprobaciones en marcha: espera el aviso COMPROBACIONES y repite el HECHO.');
  if (f.run.status === 'failed') {
    const failed = f.run.failed;
    const what = failed ? `${failed.name}${failed.timedOut ? ' (se pasó del tiempo)' : failed.exitCode === null ? '' : ` (código ${failed.exitCode})`}` : 'una comprobación';
    return block(`Rojo en ${what} sobre ${short(f.run.sha)}: pide al desarrollador que lo arregle y repite el HECHO cuando las comprobaciones estén en verde.`);
  }
  if (f.mode === 'checks+tester' && f.tester && !f.tester.pass) return block(f.tester.reason);
  return pass(`comprobaciones en verde sobre ${short(f.head)}`);
}

function listed(files: readonly string[]): string {
  const shown = files.slice(0, 5).join(', ');
  return files.length > 5 ? `${shown} (y ${files.length - 5} más)` : shown;
}

// Files a checkpoint left out (too big, a log) do not count as changes while they stay as they were.
export type SkippedFileFacts = { path: string; size: number; mtime: number };

export function remainingDirty(
  dirty: readonly string[],
  skipped: readonly SkippedFileFacts[],
  stat: (path: string) => { size: number; mtime: number } | null,
): string[] {
  const left = new Map(skipped.map((file) => [file.path, file]));
  return dirty.filter((path) => {
    const was = left.get(path);
    if (!was) return true;
    const now = stat(path);
    return !now || now.size !== was.size || now.mtime !== was.mtime;
  });
}

// Lockfiles and pubspec.yaml change with every dependency: they never count as a change of the checks.
const NEVER_DEFINITION = new Set(['bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'pubspec.lock', 'pubspec.yaml']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function keyOf(content: string | null, key: string): { present: boolean; value: string } | 'unreadable' {
  if (content === null) return { present: false, value: '' };
  try {
    const parsed: unknown = JSON.parse(content);
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[key] : undefined;
    return value === undefined ? { present: false, value: '' } : { present: true, value: canonical(value) };
  } catch {
    return 'unreadable';
  }
}

// Which of the changed files redefine how the floor is checked. A pattern is a glob, or file#key for "only when
// that key of the JSON changes"; the key is compared in the version of the base and in the one of the order.
export function checksTouched(
  files: readonly string[],
  patterns: readonly string[],
  fileAt: (path: string, side: 'base' | 'head') => string | null,
): string[] {
  const touched = new Set<string>();
  for (const file of files) {
    if (NEVER_DEFINITION.has(file.split('/').pop() ?? file)) continue;
    for (const pattern of patterns) {
      const hash = pattern.lastIndexOf('#');
      if (hash < 0) {
        if (globMatches(pattern, file)) touched.add(file);
        continue;
      }
      const glob = pattern.slice(0, hash);
      const key = pattern.slice(hash + 1);
      if (!globMatches(glob, file)) continue;
      const before = keyOf(fileAt(file, 'base'), key);
      const after = keyOf(fileAt(file, 'head'), key);
      if (before === 'unreadable' || after === 'unreadable' || before.present !== after.present || before.value !== after.value) touched.add(`${file}#${key}`);
    }
  }
  return [...touched].sort();
}
