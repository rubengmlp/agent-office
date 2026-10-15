import type { AnswerRequest, OrderRequest } from './types';

export type ApiResult = { ok: true } | { ok: false; status: number; message: string };

const OFFLINE_MESSAGE = 'Sin conexión con el hub';

async function readError(response: Response): Promise<string> {
  const fallback = `Error ${response.status}`;
  let raw: string;
  try {
    raw = (await response.text()).trim();
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const field of ['error', 'message']) {
        const value = record[field];
        if (typeof value === 'string' && value) return value;
      }
    }
  } catch {
    return raw;
  }
  return raw;
}

export class OfficeApi {
  constructor(private readonly key: string) {}

  answer(id: string, request: AnswerRequest): Promise<ApiResult> {
    return this.post(`/api/answers/${encodeURIComponent(id)}`, request, {
      409: 'Ya se contestó en el terminal',
    });
  }

  order(request: OrderRequest): Promise<ApiResult> {
    return this.post('/api/orders', request, {
      404: 'Sesión no encontrada',
      502: 'No se pudo entregar la orden',
    });
  }

  private async post(path: string, body: unknown, fixed: Record<number, string>): Promise<ApiResult> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Office-Key': this.key },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, message: OFFLINE_MESSAGE };
    }
    if (response.ok) return { ok: true };
    const message = fixed[response.status] ?? (await readError(response));
    return { ok: false, status: response.status, message };
  }
}
