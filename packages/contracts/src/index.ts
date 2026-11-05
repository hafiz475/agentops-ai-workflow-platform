import { z } from 'zod';

export const serviceStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
});

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
