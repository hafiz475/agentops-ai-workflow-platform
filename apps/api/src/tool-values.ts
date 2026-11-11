import type { z } from 'zod';
import type { conditionOperatorSchema } from '@agentops/contracts';

export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

const templatePattern = /{{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*}}/g;

export const readPath = (input: unknown, path: string): unknown => {
  let value: unknown = input;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !(segment in value))
      return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
};

export const evaluateCondition = (
  input: Record<string, unknown>,
  path: string,
  operator: ConditionOperator,
  expected?: string | number | boolean | null,
): boolean => {
  const actual = readPath(input, path);
  switch (operator) {
    case 'EXISTS':
      return actual !== undefined && actual !== null;
    case 'NOT_EXISTS':
      return actual === undefined || actual === null;
    case 'EQUALS':
      return actual === expected;
    case 'NOT_EQUALS':
      return actual !== expected;
    case 'CONTAINS':
    case 'NOT_CONTAINS': {
      const contains =
        typeof actual === 'string' && typeof expected === 'string'
          ? actual.includes(expected)
          : Array.isArray(actual)
            ? actual.some((item) => item === expected)
            : false;
      return operator === 'CONTAINS' ? contains : !contains;
    }
    case 'STARTS_WITH':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected)
      );
    case 'ENDS_WITH':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected)
      );
    case 'GREATER_THAN':
    case 'GREATER_THAN_OR_EQUAL':
    case 'LESS_THAN':
    case 'LESS_THAN_OR_EQUAL': {
      if (typeof actual !== 'number' || typeof expected !== 'number')
        throw new Error(`${operator} requires numeric actual and comparison values.`);
      if (operator === 'GREATER_THAN') return actual > expected;
      if (operator === 'GREATER_THAN_OR_EQUAL') return actual >= expected;
      if (operator === 'LESS_THAN') return actual < expected;
      return actual <= expected;
    }
  }
};

const renderString = (template: string, input: Record<string, unknown>): unknown => {
  const matches = [...template.matchAll(templatePattern)];
  if (matches.length === 1 && matches[0]?.[0] === template) {
    const value = readPath(input, matches[0][1] ?? '');
    if (value === undefined) throw new Error(`Unknown transform variable: ${matches[0][1]}.`);
    return value;
  }
  const rendered = template.replace(templatePattern, (_match, path: string) => {
    const value = readPath(input, path);
    if (value === undefined) throw new Error(`Unknown transform variable: ${path}.`);
    if (typeof value === 'object') throw new Error(`Transform variable ${path} is not scalar.`);
    return String(value);
  });
  if (rendered.includes('{{') || rendered.includes('}}'))
    throw new Error('Transform contains an invalid or unclosed placeholder.');
  return rendered;
};

export const renderStructuredValue = (value: unknown, input: Record<string, unknown>): unknown => {
  if (typeof value === 'string') return renderString(value, input);
  if (Array.isArray(value)) return value.map((item) => renderStructuredValue(item, input));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderStructuredValue(item, input)]),
    );
  return value;
};

export const validateStructuredTemplates = (value: unknown): string[] => {
  const errors: string[] = [];
  const inspect = (item: unknown) => {
    if (typeof item === 'string') {
      const stripped = item.replace(templatePattern, '');
      if (stripped.includes('{{') || stripped.includes('}}'))
        errors.push(`Invalid transform template: ${item}.`);
    } else if (Array.isArray(item)) item.forEach(inspect);
    else if (item && typeof item === 'object') Object.values(item).forEach(inspect);
  };
  inspect(value);
  return errors;
};
