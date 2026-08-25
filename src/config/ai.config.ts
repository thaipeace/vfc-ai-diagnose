export const aiConfig = () => ({
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterApiValidationKey: process.env.OPENROUTER_API_VALIDATION_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5',
  openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free',
  timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '90000', 10),
  maxRetries: parseInt(process.env.AI_MAX_RETRIES || '3', 10),
  maxReferenceItems: parseInt(process.env.AI_MAX_REFERENCE_ITEMS || '7', 10),
});
