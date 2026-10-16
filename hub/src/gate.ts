export type GateFacts = {
  officeTeam: boolean;
  floorManaged: boolean;
  owner: string | null;
  lastOwnerEdit: number | null;
  lastTesterGreen: number | null;
};

export type GateDecision = { pass: boolean; reason: string };

export function decideGate(f: GateFacts): GateDecision {
  if (!f.officeTeam || !f.floorManaged) return { pass: true, reason: 'fuera de la oficina' };
  if (f.lastOwnerEdit === null) return { pass: true, reason: 'sin cambios en el repositorio' };
  if (f.lastTesterGreen !== null && f.lastTesterGreen > f.lastOwnerEdit) {
    return { pass: true, reason: 'tester en verde después del último cambio' };
  }
  const who = f.owner ? ` de ${f.owner}` : '';
  return {
    pass: false,
    reason: `Falta tester: no hay tests en verde de un tester de esta planta posteriores al último cambio${who}. Pide al tester que pruebe lo que cambió y vuelve a intentarlo. Un test del propio desarrollador no cuenta.`,
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
