# SERP X-Ray — Prompt Remediation Plan

## Test results: 26/28 passed, 2 failed

---

## Entity Extraction Prompt

### Findings

| # | Test | Status | Details |
|---|------|--------|--------|
| 1 | Valid JSON without markdown | PASS | — |
| 2 | Limit ≤15 entities | **FAIL** | 16 instead of 15 |
| 3 | Empty text → [] | PASS | — |
| 4 | Boilerplate (menu/footer/cookie) → [] | PASS | — |
| 5 | Confidence in [0,1] | PASS | — |
| 6 | No confidence <0.5 | PASS | — |
| 7 | Name deduplication | PASS | But «OpenAI» and «Open AI Inc.» are different |
| 8 | No generic words | **FAIL** | «стулья», «доставка» extracted |
| 9 | Reproducibility (temp=0) | PASS | 70%+ overlap |
| 10 | Types: Product vs Organization | PASS | Salesforce=Org, Sales Cloud=Product |
| 11 | Types: Metric vs Concept | PASS | Numbers with context → Metric |

### Problems and fixes

#### ❌ 1. Entity limit violated (16 instead of 15)

**Cause:** the model ignores the textual limit in the middle of the prompt.

**Fix:** duplicate the limit at the end, before the response format:
```
Return no more than 15 entities. If there are more — keep the 15 most relevant.
```

#### ❌ 2. Common nouns extracted as entities

**Cause:** «стулья», «доставка» — common nouns without a brand/proper name.

**Fix:** add to the rules:
```
Do NOT extract: common nouns without a proper name
(«стулья», «доставка», «ремонт», «услуги»), generic product categories
without a brand, verbs and adjectives as entities.
```
And add a few-shot negative example:
```
Bad: {"name": "стулья", "type": "Product"}
Good: don't extract (no brand/model)
```

#### ⚠️ 3. Normalization did not kick in

**Cause:** «OpenAI» and «Open AI Inc.» — different strings. An explicit example is needed.

**Fix:** add a few-shot example:
```
Deduplication example:
Input: «OpenAI», «Open AI», «OpenAI Inc.»
Output: a single entity with name: «OpenAI»
```

---

## Gap Analysis Prompt

### Findings

| # | Test | Status |
|---|------|--------|
| G1 | Valid JSON without markdown | PASS |
| G2 | Gaps found | PASS |
| G3 | Limit ≤10 gaps | PASS |
| G4 | All fields valid | PASS |
| G5 | Direction top3→user | PASS |
| G6 | No duplicates | PASS |
| G7 | Sorted by priority | PASS |
| G8 | Recommendations are specific | PASS |
| G9 | No invented entities | PASS |
| G10 | Empty inputs → [] | PASS |
| G11 | Identical lists → [] | PASS |

### Potential improvements

#### ⚠️ 1. Entity frequency

**Current:** the top-3 entities are passed as a flat list with duplicates (if an entity is on 2+ pages, it repeats). The LLM must count the frequency itself.

**Risk:** on gpt-4o-mini the count may be imprecise.

**Fix:** pre-group entities by page on the backend and pass metadata:
```json
{"entity": "HubSpot", "type": "Product", "pages": 2, "positions": [1, 3]}
```
OR add to the prompt: «Entities may repeat — a repeat means the entity was found on one more page of the top-3.»

#### ⚠️ 2. Topic anchor

**Current:** the topic is determined «by the set and concentration of the user's entities».

**Risk:** if the user's page is small or irrelevant, the anchor is weak.

**Fix:** pass the search query into the prompt as an extra variable:
```
Query topic: {query}
```
This gives the LLM an explicit anchor for relevance filtering.

---

## Remediation Implementation Plan

### Urgent (Prompt)

1. **Entity Extraction** — strengthen the limit, add an anti-hallucination rule, few-shot normalization
2. **Gap Analysis** — add `{query}` as the topic anchor

### Code (Backend)

3. **analyzer.py** — pass `query` to `analyze_gaps()`
4. **gap_analyzer.py** — add the `query` parameter and pass it into the prompt
5. **schemas.py** — no changes required

### Optional (Code)

6. **entity_extractor.py** — add post-processing: filter common words via a dictionary
7. **analyzer.py** — group top3_entities by page before gap analysis

---

## Reference expected results

### Entity Extraction (CRM text)

```json
{
  "entities": [
    {"name": "Salesforce CRM", "type": "Product", "confidence": 0.95},
    {"name": "Gmail", "type": "Product", "confidence": 0.9},
    {"name": "Outlook", "type": "Product", "confidence": 0.9},
    {"name": "HubSpot", "type": "Product", "confidence": 0.85},
    {"name": "Zoho CRM", "type": "Product", "confidence": 0.85},
    {"name": "Gartner", "type": "Organization", "confidence": 0.9},
    {"name": "Microsoft Dynamics 365", "type": "Product", "confidence": 0.85},
    {"name": "Marc Benioff", "type": "Person", "confidence": 0.9},
    {"name": "San Francisco", "type": "Location", "confidence": 0.85},
    {"name": "Slack", "type": "Product", "confidence": 0.8},
    {"name": "Zoom", "type": "Product", "confidence": 0.8},
    {"name": "Google Workspace", "type": "Product", "confidence": 0.8},
    {"name": "$89 billion", "type": "Metric", "confidence": 0.9},
    {"name": "$25/user/month", "type": "Metric", "confidence": 0.85},
    {"name": "CRM market", "type": "Concept", "confidence": 0.7}
  ]
}
```

### Gap Analysis (CRM example)

```json
{
  "gaps": [
    {"entity": "HubSpot", "entity_type": "Product", "priority": "critical", "recommendation": "..."},
    {"entity": "Zoho CRM", "entity_type": "Product", "priority": "high", "recommendation": "..."},
    {"entity": "воронка продаж", "entity_type": "Concept", "priority": "medium", "recommendation": "..."}
  ]
}
```
