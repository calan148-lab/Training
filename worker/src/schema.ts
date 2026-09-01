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
