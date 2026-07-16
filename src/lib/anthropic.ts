import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EXTRACTION_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

const extractedIngredientSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
});

const extractedRecipeSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  baseServings: z.number().int().positive(),
  steps: z.array(z.string()).min(1),
  ingredients: z.array(extractedIngredientSchema).min(1),
});

export interface ExtractedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
}

export interface ExtractedRecipe {
  title: string;
  description: string | null;
  baseServings: number;
  steps: string[];
  ingredients: ExtractedIngredient[];
}

const SYSTEM_PROMPT = `You extract recipes and return structured JSON only — no explanation, no markdown fences, just the raw JSON object.

Return exactly this shape:
{
  "title": "Recipe name",
  "description": "One-sentence description or null",
  "baseServings": 4,
  "steps": ["Step text", "Step text"],
  "ingredients": [
    { "name": "flour", "quantity": 200, "unit": "g", "note": null },
    { "name": "salt", "quantity": null, "unit": null, "note": "to taste" }
  ]
}

Rules:
- If multiple recipes appear, extract only the most prominent one.
- Measurable ingredients: quantity as a number, unit as a string (null if unitless e.g. "3 eggs"), note as null.
- Non-measurable ("a pinch", "to taste", "oil for frying"): quantity null, unit null, note describes it.
- Steps: plain text strings, no numbering or bullet prefixes.
- baseServings: integer, default to 4 if not stated.`;

export async function extractRecipeFromImages(
  images: Array<{ buffer: Buffer; mimetype: string }>
): Promise<ExtractedRecipe> {
  const imageBlocks: Anthropic.ImageBlockParam[] = images.map((img) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: img.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      data: img.buffer.toString('base64'),
    },
  }));

  const message = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          ...imageBlocks,
          { type: 'text', text: 'Extract the recipe from these images.' },
        ],
      },
    ],
  });

  return parseModelResponse(message);
}

export async function extractRecipeFromText(text: string): Promise<ExtractedRecipe> {
  const message = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extract the recipe from this text:\n\n${text}`,
      },
    ],
  });

  return parseModelResponse(message);
}

function parseModelResponse(message: Anthropic.Message): ExtractedRecipe {
  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from extraction model');

  // Strip accidental markdown code fences if the model adds them despite the prompt
  const cleaned = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse recipe JSON from model response');

  const validation = extractedRecipeSchema.safeParse(JSON.parse(jsonMatch[0]));
  if (!validation.success) throw new Error('Extracted recipe has an unexpected shape');
  return validation.data;
}
