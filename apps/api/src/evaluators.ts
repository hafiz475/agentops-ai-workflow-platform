import type { EvaluatorConfig } from '@agentops/contracts';

export interface EvaluationOutcome {
  score: number;
  passed: boolean;
  details: string;
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const comparableValue = (value: Record<string, unknown>): unknown =>
  Object.keys(value).length === 1 && 'text' in value ? value.text : value;
const textValue = (value: Record<string, unknown>): string => {
  const comparable = comparableValue(value);
  return typeof comparable === 'string' ? comparable : JSON.stringify(comparable);
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const retrievalResults = (
  actual: Record<string, unknown>,
): Array<{ chunk_id?: string; document_id?: string }> =>
  Array.isArray(actual.retrieval_results)
    ? actual.retrieval_results.filter((item): item is { chunk_id?: string; document_id?: string } =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
    : [];

const isRelevant = (
  result: { chunk_id?: string; document_id?: string },
  chunkIds: Set<string>,
  documentIds: Set<string>,
): boolean =>
  (typeof result.chunk_id === 'string' && chunkIds.has(result.chunk_id)) ||
  (typeof result.document_id === 'string' && documentIds.has(result.document_id));

const matchesSchema = (value: unknown, schema: Record<string, unknown>): boolean => {
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some((key) => typeof key !== 'string' || !(key in object))) return false;
    const properties = schema.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
        if (key in object && child && typeof child === 'object' && !Array.isArray(child)) {
          if (!matchesSchema(object[key], child as Record<string, unknown>)) return false;
        }
      }
    }
    return true;
  }
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return type === undefined;
};

export const validateEvaluator = (config: EvaluatorConfig): string[] => {
  const errors: string[] = [];
  if (config.type === 'REGEX') {
    try {
      new RegExp(config.pattern, config.flags);
    } catch {
      errors.push('REGEX evaluator pattern is invalid.');
    }
  }
  if (config.type === 'JSON_SCHEMA') {
    const type = config.schema.type;
    const supported = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
    if (type !== undefined && (typeof type !== 'string' || !supported.includes(type))) {
      errors.push('JSON_SCHEMA evaluator uses an unsupported root type.');
    }
  }
  return errors;
};

export const evaluateOutput = (
  config: EvaluatorConfig,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): EvaluationOutcome => {
  const validationErrors = validateEvaluator(config);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' '));
  let passed = false;
  switch (config.type) {
    case 'EXACT_MATCH':
      passed = stableJson(comparableValue(actual)) === stableJson(comparableValue(expected));
      break;
    case 'CONTAINS':
      passed = config.values.every((value) => textValue(actual).includes(value));
      break;
    case 'NOT_CONTAINS':
      passed = config.values.every((value) => !textValue(actual).includes(value));
      break;
    case 'REGEX':
      passed = new RegExp(config.pattern, config.flags).test(textValue(actual));
      break;
    case 'JSON_SCHEMA':
      passed = matchesSchema(actual, config.schema);
      break;
    case 'RETRIEVAL_HIT_AT_K': {
      const expectedChunks = new Set(stringArray(expected.expected_chunk_ids));
      const expectedDocuments = new Set(stringArray(expected.expected_document_ids));
      if (!expectedChunks.size && !expectedDocuments.size)
        throw new Error('Retrieval evaluator requires expected chunk or document IDs.');
      passed = retrievalResults(actual)
        .slice(0, config.k)
        .some((result) => isRelevant(result, expectedChunks, expectedDocuments));
      break;
    }
    case 'RETRIEVAL_RECALL_AT_K': {
      const expectedChunks = new Set(stringArray(expected.expected_chunk_ids));
      const expectedDocuments = new Set(stringArray(expected.expected_document_ids));
      const expectedCount = expectedChunks.size + expectedDocuments.size;
      if (!expectedCount)
        throw new Error('Retrieval evaluator requires expected chunk or document IDs.');
      const found = new Set<string>();
      for (const result of retrievalResults(actual).slice(0, config.k)) {
        if (result.chunk_id && expectedChunks.has(result.chunk_id))
          found.add(`c:${result.chunk_id}`);
        if (result.document_id && expectedDocuments.has(result.document_id))
          found.add(`d:${result.document_id}`);
      }
      const score = found.size / expectedCount;
      return {
        score,
        passed: score === 1,
        details: `${config.type}: ${found.size}/${expectedCount}`,
      };
    }
    case 'RETRIEVAL_MRR': {
      const expectedChunks = new Set(stringArray(expected.expected_chunk_ids));
      const expectedDocuments = new Set(stringArray(expected.expected_document_ids));
      if (!expectedChunks.size && !expectedDocuments.size)
        throw new Error('Retrieval evaluator requires expected chunk or document IDs.');
      const index = retrievalResults(actual).findIndex((result) =>
        isRelevant(result, expectedChunks, expectedDocuments),
      );
      const score = index < 0 ? 0 : 1 / (index + 1);
      return {
        score,
        passed: score > 0,
        details: `${config.type}: reciprocal rank ${score}`,
      };
    }
    case 'CITATION_MATCH': {
      const cited = new Set(stringArray(actual.citations));
      passed =
        config.required_chunk_ids.every((id) => cited.has(id)) &&
        config.forbidden_chunk_ids.every((id) => !cited.has(id));
      break;
    }
    case 'AGENT_SUCCESS':
      passed = (actual.agent as Record<string, unknown> | undefined)?.status === 'COMPLETED';
      break;
    case 'MAX_STEPS_EXCEEDED':
      passed =
        (actual.agent as Record<string, unknown> | undefined)?.status === 'LIMIT_REACHED' &&
        (actual.agent as Record<string, unknown>).limit_reason === 'MAX_STEPS';
      break;
    case 'EXPECTED_TOOL_USED':
      passed = stringArray(
        (actual.agent as Record<string, unknown> | undefined)?.tools_used,
      ).includes(config.tool_name);
      break;
    case 'FORBIDDEN_TOOL_NOT_USED':
      passed = !stringArray(
        (actual.agent as Record<string, unknown> | undefined)?.tools_used,
      ).includes(config.tool_name);
      break;
  }
  return {
    score: passed ? 1 : 0,
    passed,
    details: `${config.type}: ${passed ? 'passed' : 'failed'}`,
  };
};
