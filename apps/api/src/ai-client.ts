import {
  generateRequestSchema,
  generateResponseSchema,
  embeddingRequestSchema,
  embeddingResponseSchema,
  serviceStatusSchema,
  type GenerateRequest,
  type GenerateResponse,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ServiceStatus,
} from '@agentops/contracts';

export class TransientAiError extends Error {}
export class TransientEmbeddingError extends Error {}
export interface AiServiceClient {
  ready(): Promise<ServiceStatus>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
export interface EmbeddingServiceClient {
  embedTexts(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  embedQuery(
    request: Omit<EmbeddingRequest, 'texts'> & { query: string },
  ): Promise<EmbeddingResponse>;
}
export class HttpAiServiceClient implements AiServiceClient, EmbeddingServiceClient {
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
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TransientAiError(
        error instanceof Error ? error.message : 'AI service request failed.',
      );
    }
    if (response.status >= 500 || response.status === 429)
      throw new TransientAiError(`AI provider request failed with HTTP ${response.status}`);
    if (!response.ok) throw new Error(`AI provider request failed with HTTP ${response.status}`);
    return generateResponseSchema.parse(await response.json());
  }
  public async embedTexts(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const request = embeddingRequestSchema.parse(input);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TransientEmbeddingError(
        error instanceof Error ? error.message : 'Embedding service request failed.',
      );
    }
    if (response.status >= 500 || response.status === 429)
      throw new TransientEmbeddingError(
        `Embedding provider request failed with HTTP ${response.status}`,
      );
    if (!response.ok)
      throw new Error(`Embedding provider request failed with HTTP ${response.status}`);
    const result = embeddingResponseSchema.parse(await response.json());
    if (result.vectors.length !== request.texts.length)
      throw new Error('Embedding provider returned an unexpected vector count.');
    if (result.vectors.some((vector) => vector.length !== result.dimensions))
      throw new Error('Embedding provider returned inconsistent dimensions.');
    return result;
  }
  public async embedQuery(
    input: Omit<EmbeddingRequest, 'texts'> & { query: string },
  ): Promise<EmbeddingResponse> {
    return this.embedTexts({ provider: input.provider, model: input.model, texts: [input.query] });
  }
}
