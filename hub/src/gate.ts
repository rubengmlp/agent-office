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
