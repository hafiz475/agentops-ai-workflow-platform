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
  }
  return {
    score: passed ? 1 : 0,
    passed,
    details: `${config.type}: ${passed ? 'passed' : 'failed'}`,
  };
};
