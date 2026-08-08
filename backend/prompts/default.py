ENTITY_EXTRACTION_PROMPT = """You are an SEO entity analyzer. Analyze the page text and extract all entities relevant for Knowledge Graph. For each entity, specify: name, type (one of: Person, Organization, Concept, Product, Event, Location, Metric), confidence (0-1).

Return STRICT JSON in this format:
{{"entities": [{{"name": "...", "type": "...", "confidence": 0.X}}]}}

Rules:
- Extract only meaningful entities (names, brands, products, technologies, locations)
- Do not extract common words
- Confidence: 1.0 = definitely an entity, 0.5 = possibly
- Maximum 15 entities

Page text:
{page_text}"""

GAP_ANALYSIS_PROMPT = """You are an SEO diagnostician. Compare the entities found on the user's page with entities from the top-3 search results. Find SPECIFIC gaps.

User page entities:
{user_entities}

Top-3 entities:
{top3_entities}

For each gap, specify:
- entity: entity name
- entity_type: type (Person/Organization/Concept/Product/Event/Location/Metric)
- priority: critical (missing a critical entity without which the page is incomplete) / high / medium / low
- recommendation: a specific action (1 sentence)

Return STRICT JSON in this format:
{{"gaps": [{{"entity": "...", "entity_type": "...", "priority": "...", "recommendation": "..."}}]}}

IMPORTANT: if there are no gaps, return {{"gaps": []}}. Do not invent non-existent gaps.
Note: if an entity from the top-3 is absent on the user's page, it is a gap.
Priority critical — only if the entity appears in 2+ top-3 pages and is directly related to the query topic."""