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
