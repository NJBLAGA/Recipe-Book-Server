import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EXTRACTION_MODEL = process.env.ANTHROPIC_MODEL!;

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

// Removes "Note N" / "(Note N)" cross-reference markers from ingredient text.
function stripNoteRefs(s: string): string {
  return s
    .replace(/\s*\(\s*Notes?\s+[\d,\s]+\)/gi, '')   // "(Note 1)", "(Notes 1, 2)"
    .replace(/\s*\(\s*[Ss]ee\s+[Nn]ote[^)]*\)/gi, '') // "(See note X)"
    .replace(/\s*,?\s*\bNotes?\s+\d+(\s*,\s*\d+)*/gi, '') // ", Note 1", "Note 1, 2"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Cleans a note field: strips Note refs, removes parentheses, strips stray punctuation.
function cleanNote(s: string | null): string | null {
  if (!s) return null;
  const cleaned = stripNoteRefs(s)
    .replace(/[()]/g, '')
    .replace(/^["'\s/,–—]+|["'\s/,–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
}

// Strips opening media/cross-page reference clauses from a description.
// "Recipe video above. Beef tacos…" → "Beef tacos…"
function cleanDescription(s: string | null): string | null {
  if (!s) return null;
  const cleaned = s
    .replace(/^(recipe\s+)?(video|photos?|images?)\s+(above|below|here)[.!,]?\s*/i, '')
    .replace(/^watch\s+(the\s+)?(video|recipe)[.!,]?\s*/i, '')
    .replace(/^see\s+(the\s+)?(video|photos?|images?|notes?)\s+(above|below|here)?[.!,]?\s*/i, '')
    .replace(/^step[\s-]by[\s-]step\s+photos?\s+(above|below|here)[.!,]?\s*/i, '')
    .trim();
  return cleaned || null;
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

  // Clean the note: strip Note refs, parens, stray punctuation
  note = cleanNote(note);

  return { ...raw, name, note };
}

const SYSTEM_PROMPT = `You extract recipes and return structured JSON only — no explanation, no markdown fences, just the raw JSON object.

Return exactly this shape:
{
  "title": "Recipe name",
  "description": "Brief description of the dish or null",
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
- Ingredient name must be the clean ingredient only — no parenthetical qualifiers, preparation notes, or alternates. Put those in the note field instead. Example: "1 onion, finely chopped (white, yellow or brown)" → name: "onion", note: "finely chopped, white, yellow or brown".
- Quantity ranges: when an ingredient quantity is expressed as a range (e.g. "10 to 12", "10-12", "8 – 10"), always use the lower number.
- Metric vs imperial: when both are given for one ingredient (e.g. "500 g / 1 lb", "250 ml / 1 cup", "2 kg / 4 lb"), always extract the metric value only (g, kg, ml, L). Discard the imperial equivalent.
- Note refs: "(Note 1)", "(Note 2)", "Note 1", cross-references to videos or photos must never appear in any field. Strip them entirely.
- Ingredient notes must be plain descriptive text — no parentheses, no "Note N" markers, no references to videos, photos, or other page sections.
- Description: if the text starts with a clause referencing on-page media (e.g. "Recipe video above.", "Watch the video below."), strip that clause. Start the description from the first sentence that actually describes the dish.
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
  result.description = cleanDescription(result.description);
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
  result.description = cleanDescription(result.description);
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
