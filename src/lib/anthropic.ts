import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EXTRACTION_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

const extractedIngredientSchema = z.object({
  name: z.string(),
  // Handle number, string, null, or omitted — always produce number|null
  quantity: z.preprocess((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    }
    return null;
  }, z.number().nullable()),
  unit: z.preprocess((v) => (v == null || v === '' ? null : String(v)), z.string().nullable()),
  note: z.preprocess((v) => (v == null || v === '' ? null : String(v)), z.string().nullable()),
});

const extractedRecipeSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional().transform((v) => v ?? null),
  // Coerce strings and floats — always produce a positive integer, default 4
  baseServings: z.union([z.number(), z.string()])
    .transform((v) => {
      const n = typeof v === 'string' ? parseFloat(v) : v;
      return isNaN(n) || n <= 0 ? 4 : Math.round(n);
    }),
  steps: z.array(z.string()),
  ingredients: z.array(extractedIngredientSchema),
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

// Removes "page N" references from ingredient text.
// Handles: "— page 57, or …" → "— …", "(page 57)" → "", "page 57" → "".
function stripPageRefs(s: string): string {
  return s
    // "— page N, or " → "— " (keep dash separator, drop page ref + "or")
    .replace(/([—–\-])\s*page\s+\d+\s*,\s*or\s+/gi, '$1 ')
    // "— page N," or "— page N" (no following "or") → remove dash + ref
    .replace(/\s*[—–\-]\s*page\s+\d+\s*,?/gi, '')
    // "(page N)" in parens
    .replace(/\s*\(page\s+\d+\)\s*,?/gi, '')
    // any remaining standalone "page N"
    .replace(/,?\s*\bpage\s+\d+\b\s*,?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Cleans extracted ingredient names:
//   "onion (, finely chopped (white, yellow or brown))" → name: "onion", note: "finely chopped, white, yellow or brown"
// Strips leading junk chars from names, pulls parenthetical content into note.
export function cleanIngredient(raw: ExtractedIngredient): ExtractedIngredient {
  let name = stripPageRefs(raw.name.trim());
  let note = raw.note ? stripPageRefs(raw.note.trim()) : null;

  // Pull parenthetical qualifiers out of the name into note
  const parenMatch = name.match(/^([^(,]+?)\s*[,(]+\s*(.*?)\s*[)]*$/s);
  if (parenMatch) {
    const cleanName = parenMatch[1].trim();
    const extracted = parenMatch[2]
      .replace(/[()]/g, '')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .trim();
    if (cleanName && extracted) {
      name = cleanName;
      note = note ? `${extracted}; ${note}` : extracted;
    }
  }

  // Strip any remaining leading/trailing junk characters from the name
  name = name.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\s]+$/g, '').trim();

  return { ...raw, name, note };
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
- Extract only the most prominent recipe if multiple appear.
- Ingredients may be in a sidebar, column, or list with no "Ingredients:" label — find them all.
- Steps may be numbered, bulleted, lettered, or plain prose paragraphs — extract all instructional text.
- Measurable ingredients: quantity as a number, unit as a string (null if unitless e.g. "3 eggs"), note null.
- Non-measurable ("a pinch", "to taste", "oil for frying"): quantity null, unit null, note describes it.
- Ingredient name must be the clean ingredient only — no parenthetical qualifiers or preparation notes. Put those in the note field instead. Example: "1 onion, finely chopped (white, yellow or brown)" → name: "onion", note: "finely chopped, white, yellow or brown".
- Steps: plain text strings, no numbering or bullet prefixes.
- baseServings: integer — look for "Serves N", "Makes N", "Yield N". Default to 4 if absent.
- If ingredients or steps cannot be found, return empty arrays [] — never refuse to return JSON.
- Always return valid JSON matching the exact shape above.`;

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

  const result = parseModelResponse(message);
  result.ingredients = result.ingredients.map(cleanIngredient);
  return result;
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

  const result = parseModelResponse(message);
  result.ingredients = result.ingredients.map(cleanIngredient);
  return result;
}

function parseModelResponse(message: Anthropic.Message): ExtractedRecipe {
  const block = message.content[0];
  if (!block || block.type !== 'text') throw new Error('Unexpected response type from model');

  const raw = block.text;

  // Strip markdown code fences (handle multi-line fences anywhere in the string)
  const deferred = raw.replace(/```(?:json)?\n?([\s\S]*?)```/gi, '$1').trim();

  // Find first JSON object in the response
  const jsonMatch = deferred.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[extraction] No JSON object found in model response:', raw.slice(0, 500));
    throw new Error('No JSON object in model response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[extraction] JSON.parse failed:', e, '\nRaw:', jsonMatch[0].slice(0, 500));
    throw new Error('Could not parse recipe JSON from model response');
  }

  const validation = extractedRecipeSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('[extraction] Schema validation failed:', JSON.stringify(validation.error.issues));
    console.error('[extraction] Parsed object:', JSON.stringify(parsed).slice(0, 500));
    throw new Error('Extracted recipe has an unexpected shape');
  }

  return validation.data as ExtractedRecipe;
}
