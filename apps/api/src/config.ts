import { z } from 'zod';

const configSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3001),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  DATABASE_URL: z.string().min(1).default('postgresql://agentops:agentops@localhost:5432/agentops'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379/0'),
});

export type Config = z.infer<typeof configSchema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => configSchema.parse(env);
