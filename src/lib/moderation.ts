import type { ExtractedRecipe } from './anthropic';

// Word-boundary prefix anchors (\bterm) catch all inflected forms (e.g. fucking,
// ejaculation) while avoiding false positives from legitimate food substrings.
// Full \b…\b is used where the root shares a prefix with a real word (e.g. anal
// must not match canal or analysis).
const BLOCKED_RE = new RegExp(
  [
    '\\bfuck',           // fuck, fucking, fucker …
    '\\bshit',           // shit, shitty … (does not match shiitake: s-h-i-i-t)
    '\\bcunt\\b',
    '\\bnigger\\b',
    '\\bnigga\\b',
    '\\basshole\\b',
    '\\barsehole\\b',
    '\\bpenis\\b',
    '\\bvagina',         // vagina, vaginal
    '\\bporn',           // porn, porno, pornography, pornographic
    '\\bblowjob\\b',
    'blow\\s+job',
    '\\bhandjob\\b',
    'hand\\s+job',
    '\\bfellatio\\b',
    '\\bcunnilingus\\b',
    '\\bejaculat',       // ejaculate, ejaculation
    '\\bmasturbat',      // masturbate, masturbation
    '\\bdildo\\b',
    '\\btits\\b',
    '\\btitties\\b',
    '\\bpussy\\b',
    '\\bwhore\\b',
    '\\berection\\b',
    '\\bcum\\b',         // \b prevents matching inside "scum"
    '\\banal\\b',        // \b prevents matching inside "canal" / "analysis"
    '\\bbitch\\b',
    '\\btwat\\b',
    '\\bcocksucker\\b',
    '\\bbestiality\\b',
    '\\bpedophil',       // pedophile, pedophilia
    '\\bpaedophil',      // British spelling
    '\\bincest\\b',
    '\\bsexual\\s+assault',
    '\\bchild\\s+porn',
    '\\bcp\\b',
  ].join('|'),
  'i'
);

/** Returns true if the text contains no blocked terms. */
export function textIsClean(text: string): boolean {
  return !BLOCKED_RE.test(text);
}

/**
 * Checks a URL string for blocked terms. Decodes percent-encoding first so that
 * %66uck-style bypasses are caught before the regex runs.
 */
export function urlStringIsClean(raw: string): boolean {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Leave as-is if decoding fails (malformed percent-encoding)
  }
  return !BLOCKED_RE.test(decoded);
}

/**
 * Checks all user-visible text fields in an extracted recipe: title, description,
 * ingredient names, ingredient notes, and every step. Returns true if clean.
 */
export function recipeIsClean(recipe: ExtractedRecipe): boolean {
  if (!textIsClean(recipe.title)) return false;
  if (recipe.description && !textIsClean(recipe.description)) return false;
  for (const ing of recipe.ingredients) {
    if (!textIsClean(ing.name)) return false;
    if (ing.note && !textIsClean(ing.note)) return false;
  }
  for (const step of recipe.steps) {
    if (!textIsClean(step)) return false;
  }
  return true;
}
