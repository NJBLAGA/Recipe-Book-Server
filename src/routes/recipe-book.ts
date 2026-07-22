import { Router, Request, Response, NextFunction } from 'express';
import { lookup as dnsLookup } from 'dns/promises';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { load } from 'cheerio';
import { rateLimit } from 'express-rate-limit';
import { db } from '../db';
import { recipeBook, recipeCategory, recipe, recipeIngredient, recipeImage } from '../schema/recipe';
import { ingredient } from '../schema/ingredient';
import { pantry, pantryItem } from '../schema/pantry';
import { userPinnedRecipe } from '../schema/social';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { upload } from '../lib/upload';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';
import { validateImageBuffer } from '../lib/upload';
import { findOrCreateIngredient } from '../lib/ingredient';
import {
  extractRecipeFromImages,
  extractRecipeFromText,
  ExtractedIngredient,
  ExtractedRecipe,
} from '../lib/anthropic';
import { textIsClean, urlStringIsClean, recipeIsClean } from '../lib/moderation';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

// Resolve recipeBookId for all routes in this router
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const [book] = await db
    .select({ id: recipeBook.id })
    .from(recipeBook)
    .where(eq(recipeBook.householdId, req.householdId))
    .limit(1);

  if (!book) { res.status(500).json({ error: 'Recipe book not found' }); return; }
  req.recipeBookId = book.id;
  next();
});

// Stricter rate limiter for the scan endpoint — keyed by user ID so it follows
// the account even if the IP changes. 20 scans per hour per user.
const scanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req as Request).user?.id ?? 'unknown',
  message: { error: 'Too many scan requests — please wait a few minutes before trying again' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── JSON-LD helpers (URL import) ────────────────────────────────────────────

const UNIT_PATTERN =
  /^(teaspoons?|tablespoons?|cups?|ounces?|pounds?|grams?|kilograms?|millilitres?|milliliters?|litres?|liters?|tsp\.?|tbsp\.?|oz\.?|lbs?\.?|g|kg|ml|l|fl\.?\s*oz\.?)$/i;

const FRACTION_MAP: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75,
  '⅓': 0.3333, '⅔': 0.6667,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

function parseQuantityStr(raw: string): number | null {
  let s = raw.trim();
  for (const [ch, val] of Object.entries(FRACTION_MAP)) {
    s = s.replace(ch, ` ${val}`);
  }
  let total = 0;
  for (const part of s.trim().split(/\s+/)) {
    if (!part) continue;
    if (part.includes('/')) {
      const [n, d] = part.split('/').map(Number);
      if (!isNaN(n) && !isNaN(d) && d !== 0) total += n / d;
    } else {
      const n = parseFloat(part);
      if (!isNaN(n)) total += n;
    }
  }
  return total > 0 ? total : null;
}

function parseIngredientString(raw: string): ExtractedIngredient {
  const s = raw.trim();
  const match = s.match(/^([\d\s\/\.½¼¾⅓⅔⅛⅜⅝⅞-]+)\s+(\S+)\s+([\s\S]+)$/);
  if (match) {
    const q = parseQuantityStr(match[1]);
    if (q !== null) {
      const possibleUnit = match[2];
      const rest = match[3].trim();
      if (UNIT_PATTERN.test(possibleUnit)) {
        return { name: rest, quantity: q, unit: possibleUnit, note: null };
      }
      // No unit (e.g. "3 large eggs") — absorb the word into the name
      return { name: `${possibleUnit} ${rest}`, quantity: q, unit: null, note: null };
    }
  }
  return { name: s, quantity: null, unit: null, note: s };
}

function flattenHowToSteps(raw: unknown): string[] {
  if (typeof raw === 'string') return raw ? [raw] : [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item) out.push(item);
    } else if (item && typeof item === 'object') {
      const s = item as Record<string, unknown>;
      if (s['@type'] === 'HowToSection' && Array.isArray(s.itemListElement)) {
        out.push(...flattenHowToSteps(s.itemListElement));
      } else if (typeof s.text === 'string' && s.text) {
        out.push(s.text);
      } else if (typeof s.name === 'string' && s.name) {
        out.push(s.name);
      }
    }
  }
  return out;
}

function mapJsonLdToRecipe(schema: Record<string, unknown>): ExtractedRecipe {
  const ingredients = (schema.recipeIngredient as string[] ?? []).map(parseIngredientString);
  const steps = flattenHowToSteps(schema.recipeInstructions);

  const yieldRaw = schema.recipeYield;
  let baseServings = 4;
  if (typeof yieldRaw === 'number') {
    baseServings = yieldRaw;
  } else if (typeof yieldRaw === 'string') {
    const n = parseInt(yieldRaw);
    if (!isNaN(n)) baseServings = n;
  } else if (Array.isArray(yieldRaw) && yieldRaw.length > 0) {
    const n = parseInt(String(yieldRaw[0]));
    if (!isNaN(n)) baseServings = n;
  }

  return {
    title: typeof schema.name === 'string' ? schema.name : 'Untitled Recipe',
    description: typeof schema.description === 'string' ? schema.description : null,
    baseServings,
    steps,
    ingredients,
  };
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name is required').max(200),
  quantity: z.number().positive().nullable().default(null),
  unit: z.string().trim().max(50).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
  sortOrder: z.number().int().min(0),
});

// Accept legacy string steps or new object format — normalise to objects
const stepInput = z.union([
  z.string().trim().min(1).max(5000),
  z.object({ text: z.string().trim().min(1).max(5000), subSteps: z.array(z.string().trim().max(2000)).max(20).default([]) }),
]).transform((s): { text: string; subSteps: string[] } =>
  typeof s === 'string' ? { text: s, subSteps: [] } : s
);

const createRecipeSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).optional(),
  source: z.string().trim().min(1, 'Source is required').max(500),
  baseServings: z.number().int().positive('Base servings must be a positive number'),
  categoryId: z.string().uuid().nullable().optional(),
  steps: z.array(stepInput).min(1, 'At least one step is required').max(200),
  ingredients: z.array(ingredientInputSchema).min(1, 'At least one ingredient is required').max(200),
});

const updateRecipeSchema = createRecipeSchema.partial();

const reorderImagesSchema = z.array(
  z.object({
    id: z.string().uuid(),
    sortOrder: z.number().int().min(0),
  })
).min(1).max(20);

// ─── Scan route ───────────────────────────────────────────────────────────────

// POST /api/recipe-book/scan
// Accepts 1–10 ordered images, extracts a recipe, and returns the pre-filled
// recipe shape for the frontend review form. Images are never stored.
router.post('/scan', scanLimiter, upload.array('images', 10), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'At least one image is required' });
    return;
  }

  let extracted: ExtractedRecipe;
  try {
    extracted = await extractRecipeFromImages(
      files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype }))
    );
  } catch (err) {
    console.error('[scan] Extraction failed:', err);
    res.status(422).json({ error: 'Could not extract a recipe from the provided image(s)' });
    return;
  }

  if (!recipeIsClean(extracted)) {
    res.status(422).json({ error: 'Extracted recipe contains inappropriate content' });
    return;
  }

  res.json(extracted);
});

// POST /api/recipe-book/extract-text
// Accepts raw pasted text and extracts a recipe via the text model.
router.post('/extract-text', scanLimiter, async (req, res) => {
  const parsed = z.object({ text: z.string().min(1, 'Text is required').max(50_000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  let extracted: ExtractedRecipe;
  try {
    extracted = await extractRecipeFromText(parsed.data.text);
  } catch (err) {
    console.error('[extract-text] Extraction failed:', err);
    res.status(422).json({ error: 'Could not extract a recipe from the provided text' });
    return;
  }

  if (!recipeIsClean(extracted)) {
    res.status(422).json({ error: 'Extracted recipe contains inappropriate content' });
    return;
  }

  res.json(extracted);
});

// ─── URL import route ─────────────────────────────────────────────────────────

// POST /api/recipe-book/import-url
// 1. Fetches the page and looks for a JSON-LD Recipe schema (no API call needed).
// 2. If not found, strips noise and sends the page text to the extraction model as a fallback.
router.post('/import-url', scanLimiter, async (req, res) => {
  const parsed = z.object({ url: z.string().url('A valid URL is required') }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  // Block private/loopback/link-local addresses to prevent SSRF
  const targetUrl = new URL(parsed.data.url);
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    res.status(400).json({ error: 'Only http and https URLs are supported' });
    return;
  }
  const hostname = targetUrl.hostname.toLowerCase();
  const isPrivateHost =
    ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'].includes(hostname) ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (isPrivateHost) {
    res.status(400).json({ error: 'A valid URL is required' });
    return;
  }

  // DNS pre-check: resolve the hostname and verify the IP is not private.
  // Catches hostnames that look public but are configured to resolve internally
  // (e.g. internal.company.com → 10.0.0.5). Not a complete DNS-rebinding fix
  // but eliminates the most common SSRF vectors.
  try {
    const { address } = await dnsLookup(hostname);
    const isResolvedPrivate =
      ['127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'].includes(address) ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
    if (isResolvedPrivate) {
      res.status(400).json({ error: 'A valid URL is required' });
      return;
    }
  } catch {
    // DNS resolution failed — let the fetch attempt handle it naturally
  }

  if (!urlStringIsClean(parsed.data.url)) {
    res.status(422).json({ error: 'URL contains inappropriate content' });
    return;
  }

  let html: string;
  try {
    const response = await fetch(parsed.data.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // Reject responses that declare themselves too large before reading the body
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 2_000_000) {
      res.status(422).json({ error: 'Page is too large to import — try uploading a screenshot instead.' });
      return;
    }

    // Stream the body in chunks, stopping at 2 MB to prevent memory exhaustion
    // from malicious or excessively large pages that don't declare Content-Length
    if (!response.body) throw new Error('Empty response body');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    html = '';
    try {
      while (html.length < 2_000_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
    html = html.slice(0, 2_000_000);
  } catch {
    res.status(422).json({
      error: 'Could not fetch that URL — the site may be blocking automated access. Try uploading a screenshot instead.',
    });
    return;
  }

  const $ = load(html);

  // Try JSON-LD structured data first — most recipe sites embed this and it
  // maps directly with no API call needed.
  let extracted: ExtractedRecipe | null = null;

  $('script[type="application/ld+json"]').each((_i, el) => {
    if (extracted) return;
    try {
      const data = JSON.parse($(el).html() ?? '');
      // Flatten top-level array, top-level object, and @graph containers
      const topLevel: unknown[] = Array.isArray(data) ? data : [data];
      const schemas: unknown[] = [];
      for (const item of topLevel) {
        if (item && typeof item === 'object') {
          const g = (item as Record<string, unknown>)['@graph'];
          if (Array.isArray(g)) schemas.push(...g);
          else schemas.push(item);
        }
      }
      const isRecipeType = (s: unknown): s is Record<string, unknown> => {
        if (!s || typeof s !== 'object') return false;
        const t = (s as Record<string, unknown>)['@type'];
        return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
      };
      const recipeSchema = schemas.find(isRecipeType);
      if (recipeSchema) extracted = mapJsonLdToRecipe(recipeSchema);
    } catch {
      // Malformed JSON-LD — skip this block
    }
  });

  if (extracted) {
    if (!recipeIsClean(extracted)) {
      res.status(422).json({ error: 'Extracted recipe contains inappropriate content' });
      return;
    }
    res.json(extracted);
    return;
  }

  // Fallback: strip noise from the page and send the text to the extraction model.
  $('script, style, nav, footer, header, aside, [aria-hidden="true"]').remove();
  const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20_000);

  if (pageText.length < 100) {
    res.status(422).json({
      error: 'Could not read recipe content from that page — try uploading a screenshot instead.',
    });
    return;
  }

  try {
    extracted = await extractRecipeFromText(pageText);
    if (!recipeIsClean(extracted)) {
      res.status(422).json({ error: 'Extracted recipe contains inappropriate content' });
      return;
    }
    res.json(extracted);
  } catch {
    res.status(422).json({
      error: 'Could not extract a recipe from that page — try uploading a screenshot instead.',
    });
  }
});

// ─── Category routes ──────────────────────────────────────────────────────────

// GET /api/recipe-book/categories
router.get('/categories', async (req, res) => {
  const categories = await db
    .select()
    .from(recipeCategory)
    .where(eq(recipeCategory.recipeBookId, req.recipeBookId))
    .orderBy(asc(recipeCategory.name));

  res.json(categories);
});

// POST /api/recipe-book/categories
router.post('/categories', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const [existing] = await db
    .select({ id: recipeCategory.id })
    .from(recipeCategory)
    .where(
      and(
        eq(recipeCategory.recipeBookId, req.recipeBookId),
        eq(recipeCategory.name, parsed.data.name)
      )
    )
    .limit(1);

  if (existing) {
    res.status(409).json({ error: 'A category with this name already exists' });
    return;
  }

  const [created] = await db
    .insert(recipeCategory)
    .values({ recipeBookId: req.recipeBookId, name: parsed.data.name })
    .returning();

  res.status(201).json(created);
});

// PATCH /api/recipe-book/categories/:id
router.patch('/categories/:id', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const [cat] = await db
    .select({ id: recipeCategory.id })
    .from(recipeCategory)
    .where(
      and(
        eq(recipeCategory.id, req.params.id),
        eq(recipeCategory.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!cat) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const [updated] = await db
    .update(recipeCategory)
    .set({ name: parsed.data.name })
    .where(eq(recipeCategory.id, req.params.id))
    .returning();

  res.json(updated);
});

// DELETE /api/recipe-book/categories/:id
router.delete('/categories/:id', async (req, res) => {
  const [cat] = await db
    .select({ id: recipeCategory.id })
    .from(recipeCategory)
    .where(
      and(
        eq(recipeCategory.id, req.params.id),
        eq(recipeCategory.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!cat) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  // Recipes in this category have categoryId SET NULL (schema constraint) — no manual cleanup needed
  await db.delete(recipeCategory).where(eq(recipeCategory.id, req.params.id));

  res.json({ message: 'Category deleted' });
});

// ─── Pins routes ─────────────────────────────────────────────────────────────

// GET /api/recipe-book/pins — current user's pinned recipes (positions 1-5)
router.get('/pins', async (req, res) => {
  const pins = await db
    .select({
      position: userPinnedRecipe.position,
      recipeId: userPinnedRecipe.recipeId,
      recipeTitle: recipe.title,
      recipeDescription: recipe.description,
      recipeSource: recipe.source,
      recipeImage: sql<string | null>`(SELECT url FROM recipe_image WHERE recipe_id = ${recipe.id} ORDER BY sort_order ASC LIMIT 1)`,
    })
    .from(userPinnedRecipe)
    .leftJoin(recipe, eq(userPinnedRecipe.recipeId, recipe.id))
    .where(eq(userPinnedRecipe.userId, req.user.id))
    .orderBy(asc(userPinnedRecipe.position));

  res.json(pins);
});

// PUT /api/recipe-book/pins — replace all pins atomically
router.put('/pins', async (req, res) => {
  const parsed = z.array(
    z.object({
      position: z.number().int().min(1).max(5),
      recipeId: z.string().uuid(),
    })
  ).max(5, 'Maximum 5 pinned recipes').safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const recipeIds = parsed.data.map(p => p.recipeId);
  const positions = parsed.data.map(p => p.position);

  if (new Set(recipeIds).size !== recipeIds.length) {
    res.status(400).json({ error: 'Duplicate recipes in pins' });
    return;
  }
  if (new Set(positions).size !== positions.length) {
    res.status(400).json({ error: 'Duplicate positions in pins' });
    return;
  }

  if (recipeIds.length > 0) {
    const validRecipes = await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.recipeBookId, req.recipeBookId), inArray(recipe.id, recipeIds)));

    if (validRecipes.length !== recipeIds.length) {
      res.status(400).json({ error: 'One or more recipes not found in your recipe book' });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(userPinnedRecipe).where(eq(userPinnedRecipe.userId, req.user.id));

    if (parsed.data.length > 0) {
      await tx.insert(userPinnedRecipe).values(
        parsed.data.map(p => ({ userId: req.user.id, recipeId: p.recipeId, position: p.position }))
      );
    }
  });

  res.json({ message: 'Pins updated' });
});

// ─── Can-make route ───────────────────────────────────────────────────────────

// GET /api/recipe-book/can-make — tier all recipes by pantry stock
router.get('/can-make', async (req, res) => {
  const [p] = await db
    .select({ id: pantry.id })
    .from(pantry)
    .where(eq(pantry.householdId, req.householdId))
    .limit(1);

  if (!p) { res.json({ ready: [], almost: [], rest: [] }); return; }

  const recipes = await db
    .select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(eq(recipe.recipeBookId, req.recipeBookId))
    .orderBy(asc(recipe.title));

  if (recipes.length === 0) { res.json({ ready: [], almost: [], rest: [] }); return; }

  const stockRows = await db
    .select({ ingredientId: pantryItem.ingredientId, inStock: pantryItem.inStock })
    .from(pantryItem)
    .where(eq(pantryItem.pantryId, p.id));

  const stockMap = new Map(stockRows.map(r => [r.ingredientId, r.inStock]));

  const recipeIdList = recipes.map(r => r.id);

  const ingRows = await db
    .select({
      recipeId: recipeIngredient.recipeId,
      ingredientId: recipeIngredient.ingredientId,
      name: ingredient.name,
      quantity: recipeIngredient.quantity,
    })
    .from(recipeIngredient)
    .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
    .where(inArray(recipeIngredient.recipeId, recipeIdList));

  const byRecipe = new Map<string, Array<{ ingredientId: string; name: string; quantity: string | null }>>();
  for (const row of ingRows) {
    if (!byRecipe.has(row.recipeId)) byRecipe.set(row.recipeId, []);
    byRecipe.get(row.recipeId)!.push(row);
  }

  const ready: Array<{ id: string; title: string; runningLowItems: Array<{ ingredientId: string; name: string }> }> = [];
  const almost: Array<{ id: string; title: string; matchPct: number; missingIngredients: Array<{ ingredientId: string; name: string }> }> = [];
  const rest: Array<{ id: string; title: string; matchPct: number; missingCount: number }> = [];

  for (const r of recipes) {
    const ings = byRecipe.get(r.id) ?? [];
    const measurable = ings.filter(i => i.quantity !== null);

    const missing = measurable.filter(i => !stockMap.get(i.ingredientId));

    const matchPct = measurable.length > 0
      ? Math.round(((measurable.length - missing.length) / measurable.length) * 100)
      : 100;

    if (missing.length === 0) {
      ready.push({ id: r.id, title: r.title, runningLowItems: [] });
    } else if (missing.length <= 2) {
      almost.push({
        id: r.id,
        title: r.title,
        matchPct,
        missingIngredients: missing.map(i => ({ ingredientId: i.ingredientId, name: i.name })),
      });
    } else {
      rest.push({ id: r.id, title: r.title, matchPct, missingCount: missing.length });
    }
  }

  rest.sort((a, b) => b.matchPct - a.matchPct);

  res.json({ ready, almost, rest });
});

// ─── Recipe routes ────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/recipe-book/recipes
router.get('/recipes', async (req, res) => {
  const rawCategoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const categoryId = rawCategoryId && UUID_RE.test(rawCategoryId) ? rawCategoryId : undefined;
  const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
  const search = rawSearch ? rawSearch.slice(0, 200) : undefined;
  const rawIngredients = req.query.ingredients;
  const ingredientFilters: string[] = (Array.isArray(rawIngredients)
    ? (rawIngredients as string[]).map((v) => v.trim()).filter(Boolean)
    : typeof rawIngredients === 'string'
      ? rawIngredients.split(',').map((v) => v.trim()).filter(Boolean)
      : []).slice(0, 50);

  const strict = req.query.strict === 'true';

  const conditions = [eq(recipe.recipeBookId, req.recipeBookId)];
  if (categoryId) conditions.push(eq(recipe.categoryId, categoryId));
  if (search) conditions.push(ilike(recipe.title, `%${search}%`));
  if (ingredientFilters.length > 0) {
    if (strict) {
      // Only recipes where ALL their ingredients are in the provided set
      // NOT EXISTS any ingredient in the recipe that is NOT in the list
      const lowerList = ingredientFilters.map((f) => f.toLowerCase());
      conditions.push(
        sql`NOT EXISTS (
          SELECT 1 FROM recipe_ingredient _ri
          JOIN ingredient _i ON _i.id = _ri.ingredient_id
          WHERE _ri.recipe_id = ${recipe.id}
          AND LOWER(_i.name) NOT IN (${sql.join(lowerList.map((l) => sql`${l}`), sql`, `)})
        )`
      );
    } else {
      const sub = db
        .selectDistinct({ id: recipeIngredient.recipeId })
        .from(recipeIngredient)
        .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
        .where(or(...ingredientFilters.map((name) => ilike(ingredient.name, `%${name}%`))));
      conditions.push(inArray(recipe.id, sub));
    }
  }

  const rows = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      source: recipe.source,
      baseServings: recipe.baseServings,
      categoryId: recipe.categoryId,
      categoryName: recipeCategory.name,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .leftJoin(recipeCategory, eq(recipe.categoryId, recipeCategory.id))
    .where(and(...conditions))
    .orderBy(asc(recipe.title));

  const recipeIds = rows.map((r) => r.id);
  const imgs = recipeIds.length > 0
    ? await db
        .select({ recipeId: recipeImage.recipeId, url: recipeImage.url })
        .from(recipeImage)
        .where(inArray(recipeImage.recipeId, recipeIds))
        .orderBy(asc(recipeImage.sortOrder))
    : [];
  const imageMap = new Map<string, string[]>();
  for (const img of imgs) {
    const existing = imageMap.get(img.recipeId) ?? [];
    imageMap.set(img.recipeId, [...existing, img.url]);
  }

  res.json(rows.map((r) => ({ ...r, images: imageMap.get(r.id) ?? [] })));
});

// POST /api/recipe-book/recipes
router.post('/recipes', async (req, res) => {
  const parsed = createRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { title, description, source, baseServings, categoryId, steps, ingredients } = parsed.data;

  if (!textIsClean(title)) {
    res.status(400).json({ error: 'Recipe contains inappropriate content' });
    return;
  }

  if (ingredients.some(ing => !textIsClean(ing.name) || (ing.note && !textIsClean(ing.note)))) {
    res.status(400).json({ error: 'Recipe contains inappropriate content' });
    return;
  }

  if (steps.some(step => !textIsClean(step.text))) {
    res.status(400).json({ error: 'Recipe contains inappropriate content' });
    return;
  }

  if (categoryId) {
    const [cat] = await db
      .select({ id: recipeCategory.id })
      .from(recipeCategory)
      .where(and(eq(recipeCategory.id, categoryId), eq(recipeCategory.recipeBookId, req.recipeBookId)))
      .limit(1);
    if (!cat) { res.status(400).json({ error: 'Invalid category' }); return; }
  }

  const result = await db.transaction(async (tx) => {
    const [newRecipe] = await tx
      .insert(recipe)
      .values({
        recipeBookId: req.recipeBookId,
        title,
        description,
        source,
        baseServings,
        categoryId: categoryId ?? null,
        steps,
      })
      .returning();

    const ingredientRows = await Promise.all(
      ingredients.map(async (ing) => {
        const ingredientId = await findOrCreateIngredient(tx, ing.name);
        return {
          recipeId: newRecipe.id,
          ingredientId,
          quantity: ing.quantity?.toString() ?? null,
          unit: ing.unit,
          note: ing.note,
          sortOrder: ing.sortOrder,
        };
      })
    );

    await tx.insert(recipeIngredient).values(ingredientRows);

    return newRecipe;
  });

  res.status(201).json(result);
});

// GET /api/recipe-book/recipes/:id
router.get('/recipes/:id', async (req, res) => {
  const [r] = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      source: recipe.source,
      baseServings: recipe.baseServings,
      categoryId: recipe.categoryId,
      categoryName: recipeCategory.name,
      steps: recipe.steps,
      sharedByUserId: recipe.sharedByUserId,
      originalRecipeId: recipe.originalRecipeId,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .leftJoin(recipeCategory, eq(recipe.categoryId, recipeCategory.id))
    .where(
      and(
        eq(recipe.id, req.params.id),
        eq(recipe.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!r) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const [ingredients, images] = await Promise.all([
    db
      .select({
        id: recipeIngredient.id,
        ingredientId: recipeIngredient.ingredientId,
        name: ingredient.name,
        quantity: recipeIngredient.quantity,
        unit: recipeIngredient.unit,
        note: recipeIngredient.note,
        sortOrder: recipeIngredient.sortOrder,
      })
      .from(recipeIngredient)
      .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
      .where(eq(recipeIngredient.recipeId, r.id))
      .orderBy(asc(recipeIngredient.sortOrder)),

    db
      .select({ id: recipeImage.id, url: recipeImage.url, sortOrder: recipeImage.sortOrder })
      .from(recipeImage)
      .where(eq(recipeImage.recipeId, r.id))
      .orderBy(asc(recipeImage.sortOrder)),
  ]);

  res.json({ ...r, ingredients, images });
});

// PATCH /api/recipe-book/recipes/:id
router.patch('/recipes/:id', async (req, res) => {
  const parsed = updateRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      and(
        eq(recipe.id, req.params.id),
        eq(recipe.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const { title, description, source, baseServings, categoryId, steps, ingredients } = parsed.data;

  if (title !== undefined && !textIsClean(title)) {
    res.status(400).json({ error: 'Recipe contains inappropriate content' });
    return;
  }

  if (ingredients !== undefined && ingredients.some(ing => !textIsClean(ing.name) || (ing.note && !textIsClean(ing.note)))) {
    res.status(400).json({ error: 'Recipe contains inappropriate content' });
    return;
  }

  if (steps !== undefined && steps.some(step => !textIsClean(step.text))) {
    res.status(400).json({ error: 'Recipe contains inappropriate content' });
    return;
  }

  if (categoryId) {
    const [cat] = await db
      .select({ id: recipeCategory.id })
      .from(recipeCategory)
      .where(and(eq(recipeCategory.id, categoryId), eq(recipeCategory.recipeBookId, req.recipeBookId)))
      .limit(1);
    if (!cat) { res.status(400).json({ error: 'Invalid category' }); return; }
  }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(recipe)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(source !== undefined && { source }),
        ...(baseServings !== undefined && { baseServings }),
        ...(categoryId !== undefined && { categoryId: categoryId ?? null }),
        ...(steps !== undefined && { steps }),
        updatedAt: new Date(),
      })
      .where(eq(recipe.id, req.params.id))
      .returning();

    if (ingredients !== undefined) {
      await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, req.params.id));

      const ingredientRows = await Promise.all(
        ingredients.map(async (ing) => {
          const ingredientId = await findOrCreateIngredient(tx, ing.name);
          return {
            recipeId: req.params.id,
            ingredientId,
            quantity: ing.quantity?.toString() ?? null,
            unit: ing.unit,
            note: ing.note,
            sortOrder: ing.sortOrder,
          };
        })
      );

      await tx.insert(recipeIngredient).values(ingredientRows);
    }

    return updated;
  });

  res.json(result);
});

// DELETE /api/recipe-book/recipes/:id
router.delete('/recipes/:id', async (req, res) => {
  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      and(
        eq(recipe.id, req.params.id),
        eq(recipe.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  // Fetch image URLs before delete so we can clean up Cloudinary after
  const images = await db
    .select({ url: recipeImage.url })
    .from(recipeImage)
    .where(eq(recipeImage.recipeId, req.params.id));

  await db.delete(recipe).where(eq(recipe.id, req.params.id));

  // Remove assets from Cloudinary — errors are swallowed so the API always returns 200
  for (const img of images) {
    const publicId = extractPublicId(img.url);
    if (publicId) await deleteImage(publicId).catch(() => {});
  }

  res.json({ message: 'Recipe deleted' });
});

// ─── Recipe image routes ──────────────────────────────────────────────────────

// POST /api/recipe-book/recipes/:id/images
router.post('/recipes/:id/images', upload.single('image'), async (req, res) => {
  const recipeId = req.params.id as string;
  const recipeBookId = req.recipeBookId;
  const householdId = req.householdId;

  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, recipeId), eq(recipe.recipeBookId, recipeBookId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'Image file is required' });
    return;
  }

  if (!validateImageBuffer(req.file.buffer)) {
    res.status(400).json({ error: 'Invalid image file' });
    return;
  }

  const [{ count: imgCount }] = await db
    .select({ count: count() })
    .from(recipeImage)
    .where(eq(recipeImage.recipeId, recipeId));
  if (Number(imgCount) >= 20) {
    res.status(400).json({ error: 'Maximum 20 images per recipe' });
    return;
  }

  const url = await uploadImage(req.file.buffer, `recipe-images/${householdId}`);

  const [image] = await db
    .insert(recipeImage)
    .values({ recipeId, url, sortOrder: 0 })
    .returning();

  res.status(201).json(image);
});

// PATCH /api/recipe-book/recipes/:id/images/order — update sortOrder for a set of images
router.patch('/recipes/:id/images/order', async (req, res) => {
  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, req.params.id), eq(recipe.recipeBookId, req.recipeBookId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const parsed = reorderImagesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of parsed.data) {
      await tx
        .update(recipeImage)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(recipeImage.id, item.id), eq(recipeImage.recipeId, req.params.id)));
    }
  });

  res.json({ message: 'Order updated' });
});

// DELETE /api/recipe-book/recipes/:id/images/:imageId
router.delete('/recipes/:id/images/:imageId', async (req, res) => {
  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, req.params.id), eq(recipe.recipeBookId, req.recipeBookId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const [image] = await db
    .select({ id: recipeImage.id, url: recipeImage.url })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, req.params.imageId), eq(recipeImage.recipeId, req.params.id)))
    .limit(1);

  if (!image) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  const publicId = extractPublicId(image.url);
  if (publicId) await deleteImage(publicId).catch(() => {});

  await db.delete(recipeImage).where(eq(recipeImage.id, image.id));

  res.json({ message: 'Image deleted' });
});

export default router;
