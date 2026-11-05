import { serviceStatusSchema, type ServiceStatus } from '@agentops/contracts';

export interface AiServiceClient {
  ready(): Promise<ServiceStatus>;
}

export class HttpAiServiceClient implements AiServiceClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 2_000,
  ) {}

  public async ready(): Promise<ServiceStatus> {
    const response = await fetch(`${this.baseUrl}/ready`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`AI service readiness failed with HTTP ${response.status}`);
    return serviceStatusSchema.parse(await response.json());
  }
}
