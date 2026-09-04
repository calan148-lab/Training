/**
 * The shape we force the model to return.
 *
 * `additionalProperties: false` plus a full `required` list is what makes
 * structured outputs strict — without both, the model is free to improvise
 * fields and the client has to defend against prose.
 */
export const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'One entry per distinct food visible. Empty if the photo has no food in it.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Specific name of the food, e.g. "grilled chicken thigh".' },
          portionEstimate: {
            type: 'string',
            description: 'How the portion was judged, in plain words, e.g. "about one cupped handful".',
          },
          grams: { type: 'number', description: 'Estimated edible mass in grams.' },
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          confidence: {
            type: 'number',
            description: '0 to 1. Low when the food is ambiguous or the portion has no scale reference.',
          },
        },
        required: ['name', 'portionEstimate', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'confidence'],
        additionalProperties: false,
      },
    },
    total: {
      type: 'object',
      properties: {
        kcal: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
      },
      required: ['kcal', 'protein_g', 'carbs_g', 'fat_g'],
      additionalProperties: false,
    },
    assumptions: {
      type: 'array',
      description:
        'Anything you had to guess that would change the numbers materially — hidden oil, sauce, what is under the visible layer, absence of a scale reference.',
      items: { type: 'string' },
    },
  },
  required: ['items', 'total', 'assumptions'],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You estimate the nutritional content of a meal from a photograph.

Identify each distinct food and estimate its edible mass, then its calories and macros. Work from
visual scale references — plate and bowl diameters, cutlery, hands, cans, packaging — and say in
"portionEstimate" what you judged the portion against.

Portion mass is the dominant source of error, so be explicit rather than confident: list in
"assumptions" anything you had to guess that would move the numbers by more than about 10%, such as
cooking oil you cannot see, dressings and sauces, or food hidden under the visible layer. Set a low
"confidence" on any item with no scale reference in frame.

Estimate what is actually on the plate, not a standard serving. If the photo contains no food,
return an empty items array and zero totals.`;

/**
 * A supplement label, read once per product.
 *
 * Unlike a meal, this is not a per-use estimate: you photograph the tub once and
 * the numbers are then reused for every dose, so a misread here is repeated
 * daily rather than averaged away. Hence the explicit confidence and the
 * instruction to refuse rather than guess an illegible panel.
 */
export const SUPPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Product name as printed, e.g. "Superhuman Shred".' },
    brand: { type: 'string', description: 'Brand, or empty string if not visible.' },
    kind: {
      type: 'string',
      enum: ['nutritive', 'creatine', 'stimulant', 'other'],
      description:
        'nutritive = contributes meaningful calories or protein (protein powder, mass gainer, meal replacement). creatine = any creatine form. stimulant = contains caffeine or another stimulant (pre-workout, fat burner, thermogenic). other = everything else (vitamins, minerals, omega-3).',
    },
    servingLabel: {
      type: 'string',
      description: 'One serving exactly as the label defines it, e.g. "1 scoop (30 g)" or "2 capsules".',
    },
    servingsPerContainer: { type: ['number', 'null'] },
    kcal: { type: ['number', 'null'], description: 'Energy per single serving. Null if not stated.' },
    protein_g: { type: ['number', 'null'] },
    carbs_g: { type: ['number', 'null'] },
    fat_g: { type: ['number', 'null'] },
    caffeine_mg: {
      type: ['number', 'null'],
      description: 'Caffeine per serving. Include caffeine anhydrous and any named source. Null if none.',
    },
    creatine_g: {
      type: ['number', 'null'],
      description: 'Creatine per serving in grams, any form. Null if none.',
    },
    confidence: {
      type: 'number',
      description: '0 to 1. Low when the panel is blurred, angled, partly out of frame, or not in view at all.',
    },
    assumptions: {
      type: 'array',
      description: 'Anything unreadable or inferred rather than read, and any proprietary blend that hides per-ingredient doses.',
      items: { type: 'string' },
    },
  },
  required: [
    'name', 'brand', 'kind', 'servingLabel', 'servingsPerContainer',
    'kcal', 'protein_g', 'carbs_g', 'fat_g', 'caffeine_mg', 'creatine_g',
    'confidence', 'assumptions',
  ],
  additionalProperties: false,
} as const;

export const SUPPLEMENT_PROMPT = `You read a supplement label from a photograph.

Report the Supplement Facts or Nutrition panel for ONE serving as the label itself defines a serving —
not per 100 g, and not per container. If the panel states both, convert to the single serving and say
so in "assumptions".

Classify "kind" by what the product will do to someone's training numbers, not by how it is marketed:
anything with meaningful calories or protein is "nutritive", anything containing creatine is
"creatine", anything containing caffeine or another stimulant is "stimulant". A product can plausibly
fit two; choose the one that most affects bodyweight or heart rate, in that order.

Do not guess at numbers you cannot read. If the panel is blurred, angled, cropped or absent, set a low
"confidence" and say what you could not make out. A proprietary blend that hides per-ingredient doses
must be reported in "assumptions" — record the ingredients but leave the amounts null.

Use null, never zero, for anything the label does not state. Zero means the label says zero.`;
