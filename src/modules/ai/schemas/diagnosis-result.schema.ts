import { z } from 'zod';

export const SolutionSetSchema = z.object({
  name: z.string(),
  products: z.array(z.string()),
});

export const DiagnosisResultSchema = z.object({
  disease: z.string().optional().default('Không xác định'),
  severity: z.string().optional().default('Trung bình'),
  summary: z.string().optional().default(''),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  vfcSolutionText: z.string().optional(),
  solutionSets: z.array(SolutionSetSchema).optional(),
  suggestedProducts: z.array(z.string()).optional(),
  reasons: z.record(z.string(), z.string()).optional(),
  provider: z.string().optional(),
  fallbackFrom: z.string().optional(),
  awaitingStage: z.boolean().optional(),
  availableStages: z.array(z.string()).optional(),
});

export type DiagnosisResult = z.infer<typeof DiagnosisResultSchema>;
