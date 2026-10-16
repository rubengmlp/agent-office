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

export type ReviewGateFacts = { path: string | null; round: number | null; cap: number; maxRounds: number };

// The effective cap is maxRounds plus the round of the last SIN ACUERDO: each one opens another budget.
export function decideReviewGate(f: ReviewGateFacts): GateDecision {
  if (f.round === null || f.round <= f.cap) return { pass: true, reason: 'ronda dentro del tope' };
  const spent = f.cap > f.maxRounds ? ` (${f.maxRounds} configuradas más las ${f.cap - f.maxRounds} gastadas antes del último SIN ACUERDO:)` : '';
  return {
    pass: false,
    reason: `Tope de rondas: ${f.path ?? 'el documento'} ya ha agotado sus ${f.cap} rondas de revisión${spent} (review.maxRounds = ${f.maxRounds}); la ronda ${f.round} no se abre. No repitas el REVISAR: escribe a tu jefe que se ha alcanzado el tope y espera su decisión. Solo un SIN ACUERDO: del revisor y la decisión del usuario abren otras ${f.maxRounds} rondas; el usuario también puede subir «Rondas máximas» en Ajustes.`,
  };
}
