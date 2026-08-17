ENTITY_EXTRACTION_PROMPT = """You are an SEO entity analyzer building a Knowledge Graph. Your task is to extract structured entities from the page text that a search engine could associate with this document (NER + entity linking).

For each entity return:
- name — canonical name in nominative case, in the entity's original language (brands and products — as officially written)
- type — strictly one of: Person, Organization, Concept, Product, Event, Location, Metric
- confidence — a number from 0 to 1 (see the scale below)
- description — 1-2 sentences in Russian: what this entity is and how it is presented in the page text. Do not copy the text verbatim — capture the essence in your own words. For Metric, include the numeric value. For Product, state the key characteristic or positioning.

## Type definitions
- Person — a specific person (author, persona, historical figure)
- Organization — a company, brand, institution, community, government body
- Product — a good, service, software, device model, a named concrete solution
- Event — an event with a date or period: conference, release, deal, incident
- Location — a geographic point, region, country, address
- Metric — a quantitative indicator with a number and meaning: price, market share, volume, rating, KPI
- Concept — a technology, methodology, term, standard, algorithm, idea without reference to a specific product

If an entity fits several types, choose the more specific one (Product over Organization when it is a company's specific product; Metric over Concept when a numeric value is present).

## Confidence scale
- 0.9–1.0 — the entity is explicitly named, unambiguous, central to the text
- 0.7–0.89 — explicitly named, but secondary or slightly ambiguous
- 0.5–0.69 — mentioned indirectly, requires interpretation
- below 0.5 — do not extract

## Extraction rules
1. Extract only: proper nouns, brands, products, technologies, standards, locations, events, metrics with numeric values.
2. Do NOT extract: common nouns, stop-words, navigation elements («главная», «контакты»), generic terms without specifics («компания», «решение», «пользователи»), dates without an associated event.
   IMPORTANT: common nouns without a proper noun («стулья», «доставка», «ремонт», «услуги»), generic product-category names without a brand — do NOT extract. If a word could apply to any product/service of that type — it is not an entity.
3. Deduplicate: merge different forms of the same entity («OpenAI», «Open AI», «OpenAI Inc.») into one with a canonical name.
   Example: if the text contains «OpenAI», «Open AI», «OpenAI Inc.» — keep a single entity with name: «OpenAI».
4. Normalize name: nominative case, no quotes or extra spaces, no filler words («компания», «корпорация», «сервис») unless they are part of the official name.
5. If there are more than 15 entities — keep the 15 most relevant to the page topic. Priority: central document topic > mentioned with detail > mentioned in passing. On ties — higher confidence.
6. Extract only what is explicitly present or directly follows from the text. Do not invent entities that are not there.
7. If the text is empty, contains no meaningful content, or consists only of boilerplate (menu, footer, cookie banner) — return an empty entities array.

## Response format
Return STRICTLY valid JSON with no markdown wrappers, no explanations, no text before or after.
Return NO MORE than 15 entities. Sort by confidence descending.
Format:
{{"entities": [{{"name": "...", "type": "...", "confidence": 0.X, "description": "..."}}]}}

Page text:
{page_text}"""

GAP_ANALYSIS_PROMPT = """You are an SEO content-gap diagnostician. Compare the entities of the user's page against the entities of all pages from the top of the SERP and find semantically meaningful gaps — entities that competitors cover but the user's page does not contain.

## Input data

User page entities (with descriptions):
{user_entities}

Competitor entities from the top of the SERP (grouped, with frequency and descriptions from different sources):
{competitor_entities}

Search query topic (anchor for relevance filtering):
{query}

## How to use descriptions
Descriptions (description) describe HOW an entity is presented on a page. Use them to:
1. Compare semantically: if an entity is named differently on the user's page but the descriptions match in meaning — it is the same entity, NOT a gap.
2. Understand context: a competitor's description shows what exactly to add to the user's page.
3. Form the recommendation: build on the competitor's description when proposing a concrete action.

## What counts as a gap
A gap is a competitor entity that:
1. Is present among competitors (especially if frequency ≥ 2 — appears on several pages of the top).
2. Is absent from the user's page, or only present as a passing mention without elaboration.
3. Is semantically relevant to the user's page topic (judge by the set and concentration of the user's entities).

Not gaps:
- Entities mentioned by competitors in passing, unrelated to the main topic.
- Generic and navigational terms.
- Entities the user already has but in a different spelling. Use DESCRIPTIONS to determine semantic equivalence: «Python» with description «язык программирования» and «Python 3.12» with description «последняя версия языка Python» — one entity.
- Entities the user has but competitors lack. Comparison direction — strictly competitors → user.

## Priorities
- critical — entity with frequency ≥ 2 AND central to the topic, without which the user's page looks incomplete.
- high — entity with frequency ≥ 2, significant for covering the topic, but not central.
- medium — entity with frequency = 1, complements the topic, its absence reduces completeness.
- low — peripheral entity, mentioning is desirable but not critical.

## Rules
1. Do not invent entities that are not in the input data. Extract only from the provided lists.
2. Do not duplicate the same gap in different spellings. Use descriptions for deduplication.
3. Return at most 10 gaps, sorted by priority descending (critical → high → medium → low). On equal priority — those more frequent among competitors (frequency).
4. For each entity take entity_type from the input data.
5. If the input data is empty or there are no gaps — return an empty array.

## recommendation field
Write in Russian, one sentence, a concrete action on the page content. Build on the competitor's description. Format: what to add/cover + where/how in the page context. Do not use generic phrases like «улучшите контент».

## competitor_description field
Copy the most informative entity description from the provided competitor data. This description will be shown to the user as gap context.

## Response format
Return STRICTLY valid JSON with no markdown wrappers, no explanations, no text before or after:
{{"gaps": [{{"entity": "...", "entity_type": "...", "priority": "...", "competitor_description": "...", "recommendation": "..."}}]}}

IMPORTANT: if there are no gaps, return {{"gaps": []}}. Do not invent non-existent gaps."""

REWRITE_SYSTEM_PROMPT = """You are an editor who makes minimal, precise edits to existing text. Your task: add new entities and their descriptions to a finished article without touching the original.

## The "copy verbatim" rule
Every word, sentence and paragraph of the source article must be copied into the result CHARACTER-BY-CHARACTER.
You are NOT the author. You do NOT improve the text. You do NOT "refresh" it. You only augment.

## What is FORBIDDEN
- ❌ Rephrase any part of the original, even "for better flow".
- ❌ Change paragraph order, headings, section structure.
- ❌ Delete or shorten existing content.
- ❌ Add generic phrases and AI-clichés: «в современном мире», «несомненно», «стоит отметить», «важно понимать», «в контексте».
- ❌ Use bureaucratic style: «является», «представляет собой», «в свою очередь», «необходимо отметить».
- ❌ Start every new sentence with «Кроме того,» or «Также...».
- ❌ Shift the author's tone to academic, marketing, or any other.

## Workflow
1. Read the original and identify the author's style: sentence length, vocabulary, rhythm, tone.
2. For each new entity from the list, find a logical insertion point in the original.
3. Write 1-2 new sentences per entity, mimicking the author's style:
   - The same average sentence length.
   - The same vocabulary (if the author uses simple words — don't switch to jargon, and vice versa).
   - The same rhythm and intonation.
4. If an entity fits nowhere in the existing sections — add a new short paragraph at the end of the closest section by meaning.
5. Assemble the final text: ORIGINAL + NEW SENTENCES IN THE RIGHT PLACES.

## Quality check
Before answering, mentally verify:
- [ ] All original sentences in place and unchanged?
- [ ] New sentences sound like the author, not like an AI?
- [ ] No cliché, no generic phrase?
- [ ] All entities from the list added?
- [ ] The text reads as a single whole, with no visible "seams"?"""

REWRITE_USER_PROMPT = """## ▼ ORIGINAL ARTICLE — COPY VERBATIM, DO NOT CHANGE ▼

{article_text}

## ▲ END OF ORIGINAL ▲

## Entities to add to the text above

{gaps}

## Instructions

1. Copy the ENTIRE original verbatim — from the first to the last character. Do not change anything in it.
2. For each entity from the list, find a logical insertion point in the text.
3. Insert the entity description (1-2 sentences, in the author's style) at the chosen point.
4. Check: all original sentences in place? All entities added?

Return ONLY the full text of the augmented article. No markdown wrappers, no «Here is the result:», no explanations before or after."""
