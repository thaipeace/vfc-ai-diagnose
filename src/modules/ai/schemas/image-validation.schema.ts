import { z } from 'zod';

export const ImageValidationReasonCodeEnum = z.enum([
  'VALID',
  'NOT_A_PLANT',
  'WRONG_CROP',
  'BLURRY_IMAGE',
]);

export type ImageValidationReasonCode = z.infer<
  typeof ImageValidationReasonCodeEnum
>;

export const ImageValidationSchema = z.object({
  isValid: z.boolean(),
  reasonCode: ImageValidationReasonCodeEnum,
  userGuidance: z.string(),
  detectedGrowthStage: z.string().nullable().optional(),
  detectedPestDisease: z.string().nullable().optional(),
  detectedSeverityLevel: z.string().nullable().optional(),
  plantInfo: z.string().nullable().optional(),
});

export type ImageValidationResult = z.infer<typeof ImageValidationSchema>;
