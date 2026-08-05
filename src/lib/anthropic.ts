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

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Normalises temperatures in step text — keeps Celsius, drops Fahrenheit.
// "Preheat to 180C/350F" → "Preheat to 180°C"
// "350F/180C" → "180°C"  (handles imperial-first ordering too)
export function cleanStepText(s: string): string {
  return decodeHtmlEntities(s)
    // Celsius first: "180C / 350F" or "180°C/350°F"
    .replace(/(\d+)\s*°?\s*C\s*[/\\]\s*\d+\s*°?\s*F\b/gi, '$1°C')
    // Fahrenheit first: "350F / 180C"
    .replace(/\d+\s*°?\s*F\s*[/\\]\s*(\d+)\s*°?\s*C\b/gi, '$1°C')
    // Bare "180C" with no slash pair → add degree symbol
    .replace(/(\d+)\s*°?\s*C\b(?!\s*\/)/gi, '$1°C')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
    .replace(/[()""'']/g, '')
    .replace(/^["'\s/,–—]+|["'\s/,–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
}

// Strips opening media/cross-page reference sentences from a description.
// Exported so the JSON-LD path in recipe-book.ts can use the same cleaner.
// "Recipe video above. Beef tacos…" → "Beef tacos…"
export function cleanDescription(s: string | null): string | null {
  if (!s) return null;
  let text = decodeHtmlEntities(s).trim();

  // Remove known opening-clause patterns
  text = text
    .replace(/^(recipe\s+)?(video|photos?|images?)\s+(above|below|here)[.!,]?\s*/i, '')
    .replace(/^watch\s+(the\s+)?(video|recipe)[.!,]?\s*/i, '')
    .replace(/^see\s+(the\s+)?(video|photos?|images?|notes?)\s*(above|below|here)?[.!,]?\s*/i, '')
    .replace(/^step[\s-]by[\s-]step\s+photos?\s*(above|below|here)?[.!,]?\s*/i, '')
    .trim();

  // Fallback: if the first sentence (up to first . or !) is short and contains
  // "video", "photo", or "image" as standalone words, strip it entirely.
  const firstStop = text.search(/[.!]/);
  if (firstStop !== -1 && firstStop < 80) {
    const firstSentence = text.slice(0, firstStop + 1);
    if (/\b(video|photo|image)\b/i.test(firstSentence)) {
      text = text.slice(firstStop + 1).replace(/^\s+/, '');
    }
  }

  return text || null;
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

INGREDIENT RULES — follow every one exactly:

1. Clean name only. The name field holds the ingredient only — no quantities, no units, no preparation notes, no alternate options, no parenthetical content. Move everything else to note.
   BAD:  name: "crispy taco shells (\"stand and stuff\") OR soft tortillas of choice (Note 1)"
   GOOD: name: "crispy taco shells",  note: "stand and stuff or soft tortillas of choice"

2. Quantity ranges → use the lower number.
   "10 to 12 taco shells" → quantity: 10
   "8–10 leaves" → quantity: 8

3. Weight units: when a source lists both metric and imperial for weight, extract only the metric value.
   "500 g / 1 lb beef" → quantity: 500, unit: "g"
   "2 kg / 4 lb chicken" → quantity: 2, unit: "kg"
   Volume measures (cups, tsp, tbsp, ml, L) are NOT converted — extract exactly as written.
   Cups, tsp, and tbsp are universal: if the recipe uses them, keep them.
   "1 cup / 250 ml milk" → quantity: 1, unit: "cups"
   "250 ml / 1 cup milk" → quantity: 250, unit: "ml"

4. Note field: plain text only. No parentheses, no "Note N" markers, no references to videos or page sections.
   "500 g beef, ground / mince (Note 2)" → name: "beef", quantity: 500, unit: "g", note: "ground or mince"
   "2 cloves garlic, minced (Note 3)" → name: "garlic", quantity: 2, unit: null, note: "minced"

5. Non-measurable ingredients ("a pinch", "to taste", "oil for frying"): quantity null, unit null, note describes it.

DESCRIPTION RULES:

6. Never start the description with a reference to on-page media. If the source description begins with a sentence like "Recipe video above.", "Watch the video:", "See photos below:" — remove that sentence entirely. Start from the first sentence that describes the dish itself.
   BAD:  "Recipe video above. Beef tacos – the old school way! A juicy filling..."
   GOOD: "Beef tacos – the old school way! A juicy filling..."

GENERAL RULES:

STEP RULES:

7. Temperature: when a step lists both Celsius and Fahrenheit (e.g. "180C/350F" or "350°F / 180°C"), always use only the Celsius value. Remove the Fahrenheit entirely.
   BAD:  "Preheat oven to 180C/350F."
   GOOD: "Preheat oven to 180°C."

GENERAL RULES:

8. Extract only the most prominent recipe if multiple appear.
9. Steps: plain text strings, no numbering or bullet prefixes.
10. baseServings: integer from "Serves N", "Makes N", "Yield N". Default 4 if absent.
11. If ingredients or steps cannot be found, return empty arrays [].
12. Always return valid JSON matching the exact shape above — no explanation, no markdown.`;

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
  result.title = decodeHtmlEntities(result.title);
  result.description = result.description ? decodeHtmlEntities(result.description) : null;
  result.steps = result.steps.map(decodeHtmlEntities);
  result.ingredients = result.ingredients.map((i) => ({
    ...i,
    name: decodeHtmlEntities(i.name),
    note: i.note ? decodeHtmlEntities(i.note) : null,
  }));
  result.ingredients = result.ingredients.map(cleanIngredient);
  result.steps = result.steps.map(cleanStepText);
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
  result.title = decodeHtmlEntities(result.title);
  result.description = result.description ? decodeHtmlEntities(result.description) : null;
  result.steps = result.steps.map(decodeHtmlEntities);
  result.ingredients = result.ingredients.map((i) => ({
    ...i,
    name: decodeHtmlEntities(i.name),
    note: i.note ? decodeHtmlEntities(i.note) : null,
  }));
  result.ingredients = result.ingredients.map(cleanIngredient);
  result.steps = result.steps.map(cleanStepText);
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

export async function suggestCategory(
  name: string,
  type: 'recipe' | 'pantry' | 'shopping-list',
  existingCategories: string[],
): Promise<string> {
  const typeLabel = type === 'recipe' ? 'recipe'
    : type === 'pantry' ? 'pantry item'
    : 'shopping list item';
  const catList = existingCategories.length
    ? `Existing categories: ${existingCategories.join(', ')}.`
    : 'There are no existing categories yet.';

  const msg = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `You are a home cooking assistant helping organise a ${typeLabel} called "${name}". ${catList} Suggest the single best category for this item. If an existing category fits well, return its exact name. Otherwise suggest a concise new category name (2–3 words maximum). Reply with the category name only — nothing else.`,
    }],
  });

  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
