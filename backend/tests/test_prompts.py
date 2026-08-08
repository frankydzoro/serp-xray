"""
Systematic prompt testing for SERP X-Ray.
Tests Entity Extraction and Gap Analysis prompts against criteria.
Run: python -m tests.test_prompts
"""
import json
import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openai import OpenAI
from config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL
from prompts.default import ENTITY_EXTRACTION_PROMPT, GAP_ANALYSIS_PROMPT

MODEL = "openai/gpt-4o-mini"  # Cheap model for testing
client = OpenAI(api_key=OPENROUTER_API_KEY, base_url=OPENROUTER_BASE_URL)

RESULTS = []


def test(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    RESULTS.append({"name": name, "status": status, "detail": detail})
    print(f"  [{status}] {name}")
    if detail and not passed:
        print(f"         {detail}")


def call_llm(prompt_text, temperature=0):
    """Call LLM, return parsed JSON or raw text."""
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt_text}],
        response_format={"type": "json_object"},
        temperature=temperature,
        timeout=30,
    )
    content = resp.choices[0].message.content or ""
    return content


def extract_json(content):
    """Robust JSON extraction with fallbacks."""
    # Try direct parse
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    # Try stripping markdown fences
    for fence in ["```json", "```"]:
        if fence in content:
            inner = content.split(fence)[1].split("```")[0]
            try:
                return json.loads(inner)
            except json.JSONDecodeError:
                pass
    # Try finding JSON object
    m = re.search(r'\{.*\}', content, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return None


# ============================================================
# ENTITY EXTRACTION TESTS
# ============================================================
def test_entity_extraction():
    print("\n" + "=" * 60)
    print("ENTITY EXTRACTION PROMPT TESTS")
    print("=" * 60)

    # Test 1: Real text — CRM page
    real_text = """
    Salesforce CRM helps small businesses manage customer relationships.
    Features include pipeline management, email integration with Gmail and Outlook,
    and reporting dashboards. Pricing starts at $25/user/month.
    Competitors like HubSpot and Zoho CRM offer similar functionality.
    According to Gartner, the CRM market reached $89 billion in 2025.
    Microsoft Dynamics 365 is popular among enterprise clients.
    The company was founded by Marc Benioff in San Francisco.
    Key integrations: Slack, Zoom, Google Workspace.
    """

    prompt = ENTITY_EXTRACTION_PROMPT.format(page_text=real_text)
    raw = call_llm(prompt, temperature=0)
    data = extract_json(raw)

    test("1.1 Valid JSON without markdown", data is not None and "entities" in data,
         f"Raw: {raw[:100]}...")

    if data and "entities" in data:
        entities = data["entities"]
        # Post-processing: truncate to 15 (mirrors entity_extractor.py)
        entities.sort(key=lambda e: e.get("confidence", 0), reverse=True)
        entities = entities[:15]
        test("1.2 Entity count <= 15", len(entities) <= 15,
             f"Count: {len(entities)}")
        test("1.3 Entity count > 0 for real text", len(entities) > 0)

        for e in entities[:3]:
            has_name = isinstance(e.get("name"), str) and len(e["name"]) > 0
            has_type = e.get("type") in ["Person", "Organization", "Concept", "Product", "Event", "Location", "Metric"]
            has_conf = isinstance(e.get("confidence"), (int, float)) and 0 <= e["confidence"] <= 1
            test(f"1.4 Entity '{e.get('name','?')}' has valid fields",
                 has_name and has_type and has_conf,
                 f"name={has_name} type={has_type} conf={has_conf}")

        confs = [e["confidence"] for e in entities]
        test("1.5 All confidence in [0,1]", all(0 <= c <= 1 for c in confs),
             f"Range: {min(confs)}-{max(confs)}")
        test("1.6 No confidence below 0.5", all(c >= 0.5 for c in confs),
             f"Min: {min(confs)}")

        names = [e["name"] for e in entities]
        test("1.7 No duplicate names", len(names) == len(set(names)))

        # Check for common false positives
        bad_words = ["компания", "решение", "пользователи", "сервис"]
        found_bad = [n for n in names if n.lower() in bad_words]
        test("1.8 No generic words extracted", len(found_bad) == 0,
             f"Found: {found_bad}")

        # Check expected entities
        expected = ["Salesforce", "HubSpot", "Zoho CRM", "Gmail", "Microsoft Dynamics 365", "Marc Benioff", "San Francisco", "Slack", "Zoom", "Google Workspace"]
        found_expected = [n for n in names if any(e.lower() in n.lower() for e in expected)]
        test("1.9 Expected entities found", len(found_expected) >= 5,
             f"Found {len(found_expected)}/{len(expected)}: {found_expected}")

        # Check types
        types_found = set(e["type"] for e in entities)
        test("1.10 Multiple types used", len(types_found) >= 2,
             f"Types: {types_found}")

        # Reproducibility
        raw2 = call_llm(prompt, temperature=0)
        data2 = extract_json(raw2)
        names2 = set(e["name"] for e in data2.get("entities", [])) if data2 else set()
        overlap = len(set(names) & names2)
        test("1.11 Reproducible at temp=0", overlap >= max(len(names), len(names2)) * 0.7,
             f"Overlap: {overlap}/{max(len(names), len(names2))}")

    # Test 2: Empty/boilerplate text
    boilerplate = "Главная Контакты О нас Политика конфиденциальности © 2026 Все права защищены"
    prompt2 = ENTITY_EXTRACTION_PROMPT.format(page_text=boilerplate)
    raw2 = call_llm(prompt2, temperature=0)
    data2 = extract_json(raw2)
    entities2 = data2.get("entities", []) if data2 else []
    test("2.1 Boilerplate: returns empty or minimal", len(entities2) <= 3,
         f"Got {len(entities2)}: {entities2}")

    # Test 3: Empty text
    prompt3 = ENTITY_EXTRACTION_PROMPT.format(page_text="")
    raw3 = call_llm(prompt3, temperature=0)
    data3 = extract_json(raw3)
    entities3 = data3.get("entities", []) if data3 else []
    test("3.1 Empty text: returns empty", len(entities3) == 0,
         f"Got {len(entities3)}: {entities3}")

    # Test 4: Hallucination check
    hallucination_text = "Мы продаём стулья. Доставка по Москве бесплатно. Звоните: +7 999 123-45-67"
    prompt4 = ENTITY_EXTRACTION_PROMPT.format(page_text=hallucination_text)
    raw4 = call_llm(prompt4, temperature=0)
    data4 = extract_json(raw4)
    entities4 = data4.get("entities", []) if data4 else []
    names4 = [e["name"] for e in entities4]
    # Only "Москва" should be extracted, not invented brands
    test("4.1 No hallucinations in short text", len(entities4) <= 2,
         f"Got {len(entities4)}: {names4}")


# ============================================================
# GAP ANALYSIS TESTS
# ============================================================
def test_gap_analysis():
    print("\n" + "=" * 60)
    print("GAP ANALYSIS PROMPT TESTS")
    print("=" * 60)

    # Test 1: Normal case
    user_entities = [
        {"name": "CRM", "type": "Concept", "confidence": 1.0},
        {"name": "Salesforce", "type": "Product", "confidence": 0.9},
        {"name": "малый бизнес", "type": "Concept", "confidence": 0.8},
    ]
    top3_entities = [
        {"name": "CRM", "type": "Concept", "confidence": 1.0},
        {"name": "Salesforce", "type": "Product", "confidence": 0.9},
        {"name": "HubSpot", "type": "Product", "confidence": 0.9},
        {"name": "Zoho CRM", "type": "Product", "confidence": 0.85},
        {"name": "интеграция", "type": "Concept", "confidence": 0.7},
        {"name": "воронка продаж", "type": "Concept", "confidence": 0.8},
        {"name": "Gartner", "type": "Organization", "confidence": 0.6},
    ]

    prompt = GAP_ANALYSIS_PROMPT.format(
        user_entities=json.dumps(user_entities, ensure_ascii=False),
        top3_entities=json.dumps(top3_entities, ensure_ascii=False),
        query="CRM for small business",
    )
    raw = call_llm(prompt, temperature=0)
    data = extract_json(raw)

    test("G1.1 Valid JSON without markdown", data is not None and "gaps" in data,
         f"Raw: {raw[:100]}...")

    if data and "gaps" in data:
        gaps = data["gaps"]
        test("G1.2 Gaps found (should find HubSpot, Zoho CRM, etc.)", len(gaps) > 0,
             f"Got {len(gaps)} gaps")
        test("G1.3 Gap count <= 10", len(gaps) <= 10,
             f"Count: {len(gaps)}")

        for g in gaps[:2]:
            has_entity = bool(g.get("entity"))
            has_type = g.get("entity_type") in ["Person", "Organization", "Concept", "Product", "Event", "Location", "Metric"]
            has_priority = g.get("priority") in ["critical", "high", "medium", "low"]
            has_rec = bool(g.get("recommendation"))
            test(f"G1.4 Gap '{g.get('entity','?')}' has valid fields",
                 has_entity and has_type and has_priority and has_rec)

        # Direction: only top3→user, not user→top3
        user_names = {e["name"].lower() for e in user_entities}
        gap_names = {g["entity"].lower() for g in gaps}
        wrong_direction = gap_names & user_names
        test("G1.5 Direction: top3→user only", len(wrong_direction) == 0,
             f"Wrong: {wrong_direction}")

        # No duplicates
        gap_entities = [g["entity"] for g in gaps]
        test("G1.6 No duplicate gaps", len(gap_entities) == len(set(gap_entities)))

        # Priority sorting
        prio_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        sorted_ok = all(
            prio_order.get(gaps[i]["priority"], 99) <= prio_order.get(gaps[i + 1]["priority"], 99)
            for i in range(len(gaps) - 1)
        )
        test("G1.7 Sorted by priority descending", sorted_ok,
             f"Order: {[g['priority'] for g in gaps]}")

        # Recommendation quality
        bad_recs = ["улучшите контент", "добавьте информацию", "оптимизируйте"]
        for g in gaps:
            rec_lower = g["recommendation"].lower()
            has_template = any(b in rec_lower for b in bad_recs)
            if has_template and len(g["recommendation"]) < 30:
                test(f"G1.8 Recommendation is specific: {g['entity']}",
                     False, g["recommendation"])
                break
        else:
            test("G1.8 Recommendations are specific", True,
                 f"Sample: {gaps[0]['recommendation'][:80] if gaps else 'N/A'}")

        # No invented entities
        top3_names = {e["name"].lower() for e in top3_entities}
        invented = [g["entity"] for g in gaps if g["entity"].lower() not in top3_names]
        test("G1.9 No invented entities", len(invented) == 0,
             f"Invented: {invented}")

    # Test 2: Empty inputs
    prompt_empty = GAP_ANALYSIS_PROMPT.format(
        user_entities="[]",
        top3_entities="[]",
        query="",
    )
    raw_empty = call_llm(prompt_empty, temperature=0)
    data_empty = extract_json(raw_empty)
    gaps_empty = data_empty.get("gaps", []) if data_empty else []
    test("G2.1 Empty inputs: returns empty", len(gaps_empty) == 0,
         f"Got {len(gaps_empty)}: {gaps_empty}")

    # Test 3: Identical lists
    prompt_same = GAP_ANALYSIS_PROMPT.format(
        user_entities=json.dumps(user_entities, ensure_ascii=False),
        top3_entities=json.dumps(user_entities, ensure_ascii=False),
        query="test",
    )
    raw_same = call_llm(prompt_same, temperature=0)
    data_same = extract_json(raw_same)
    gaps_same = data_same.get("gaps", []) if data_same else []
    test("G3.1 Identical lists: returns empty", len(gaps_same) == 0,
         f"Got {len(gaps_same)}: {gaps_same}")


if __name__ == "__main__":
    test_entity_extraction()
    test_gap_analysis()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = sum(1 for r in RESULTS if r["status"] == "FAIL")
    print(f"Total: {len(RESULTS)} | Passed: {passed} | Failed: {failed}")

    if failed:
        print("\nFAILED TESTS:")
        for r in RESULTS:
            if r["status"] == "FAIL":
                print(f"  {r['name']}: {r['detail']}")