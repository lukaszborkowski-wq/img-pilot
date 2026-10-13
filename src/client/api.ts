import type {
  AiRequest,
  AiResult,
  ApplyRequest,
  ApplyResult,
  InspectRequest,
  InspectResult,
  StatusResult,
} from '../shared';

export function createApi(endpoint: string) {
  const base = endpoint.replace(/\/$/, '');

  async function call<T>(action: string, body?: unknown): Promise<T> {
    const res = await fetch(
      `${base}/${action}`,
      body === undefined
        ? undefined
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    let json: (T & { error?: string }) | null = null;
    try {
      json = await res.json();
    } catch {
      // handled below
    }
    if (!res.ok || !json || json.error) throw new Error(json?.error ?? `img-pilot: HTTP ${res.status}`);
    return json;
  }

  return {
    status: () => call<StatusResult>('status'),
    inspect: (body: InspectRequest) => call<InspectResult>('inspect', body),
    ai: (body: AiRequest) => call<AiResult>('ai', body),
    apply: (body: ApplyRequest) => call<ApplyResult>('apply', body),
  };
}

export type Api = ReturnType<typeof createApi>;
