import type {
  AnswerRequest,
  DocumentContent,
  LessonCreate,
  LessonView,
  MemoryView,
  OrderRequest,
  PlanDecision,
  ReportView,
  RoleId,
  SettingsResult,
  SettingsUpdate,
  SettingsView,
} from './types';

export type ApiResult = { ok: true } | { ok: false; status: number; message: string };

export type ApiData<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

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

  settings(): Promise<ApiData<SettingsView>> {
    return this.get('/api/settings');
  }

  saveSettings(update: SettingsUpdate): Promise<ApiData<SettingsResult>> {
    return this.send('POST', '/api/settings', update);
  }

  memory(floor: string, role: RoleId): Promise<ApiData<MemoryView>> {
    return this.get(`/api/memory/${encodeURIComponent(floor)}/${encodeURIComponent(role)}`);
  }

  addLesson(lesson: LessonCreate): Promise<ApiData<{ lesson: LessonView }>> {
    return this.send('POST', '/api/memory', lesson);
  }

  deleteLesson(id: number): Promise<ApiData<{ ok: true }>> {
    return this.send('DELETE', `/api/memory/${id}`, undefined);
  }

  report(agentKey: string): Promise<ApiData<ReportView>> {
    return this.get(`/api/reports/${encodeURIComponent(agentKey)}`);
  }

  documentContent(path: string): Promise<ApiData<DocumentContent>> {
    return this.get(`/api/documents/content?path=${encodeURIComponent(path)}`);
  }

  discardDocument(path: string): Promise<ApiData<{ ok: true }>> {
    return this.send('POST', '/api/documents/discard', { path });
  }

  decidePlan(path: string, decision: PlanDecision): Promise<ApiData<{ ok: true }>> {
    return this.send('POST', '/api/documents/decide', { path, decision });
  }

  private get<T>(path: string): Promise<ApiData<T>> {
    return this.send('GET', path, undefined);
  }

  private async send<T>(method: string, path: string, body: unknown): Promise<ApiData<T>> {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Office-Key': this.key },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, message: OFFLINE_MESSAGE };
    }
    if (!response.ok) return { ok: false, status: response.status, message: await readError(response) };
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, status: response.status, message: 'Respuesta no válida del hub' };
    }
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
