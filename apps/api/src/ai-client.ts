import {
  generateRequestSchema,
  generateResponseSchema,
  serviceStatusSchema,
  type GenerateRequest,
  type GenerateResponse,
  type ServiceStatus,
} from '@agentops/contracts';

export interface AiServiceClient {
  ready(): Promise<ServiceStatus>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}

export class HttpAiServiceClient implements AiServiceClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 30_000,
  ) {}

  public async ready(): Promise<ServiceStatus> {
    const response = await fetch(`${this.baseUrl}/ready`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`AI service readiness failed with HTTP ${response.status}`);
    return serviceStatusSchema.parse(await response.json());
  }

  public async generate(input: GenerateRequest): Promise<GenerateResponse> {
    const request = generateRequestSchema.parse(input);
    const response = await fetch(`${this.baseUrl}/v1/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`AI provider request failed with HTTP ${response.status}`);
    return generateResponseSchema.parse(await response.json());
  }
}
