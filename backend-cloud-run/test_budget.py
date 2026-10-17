"""Self-check for the money path and the scene-input guardrails. Run: python test_budget.py"""
from fastapi import HTTPException
from main import (
    SceneBreakdownSchema, CostTriggerSpan, apply_overrides, calculate_deterministic_budget,
    keep_quoted_triggers, validate_scene_text,
    LocationAuditSchema, LocationHazard, image_mime, price_location_audit,
)


def trigger(category, quantity=1, hours=0.0):
    return CostTriggerSpan(
        exact_script_quote="x", category=category, item_description="", quantity=quantity,
        shoot_time_penalty_hours=hours, risk_level="LOW", line_producer_note="",
    )


bd = SceneBreakdownSchema(
    is_screenplay_scene=True, rejection_reason="", scene_heading="EXT. TEST - DAY", int_ext="EXT", time_of_day="DAY", page_eighths=4,
    base_setup_hours=4.0, speaking_cast_count=2, background_extras_count=10,
    cost_triggers=[trigger("CROWD_EXTRAS", quantity=10, hours=1.0), trigger("STUNTS_PYRO", hours=1.0)],
    schedule_hazard_warnings=[], city_production_notes=[],
)

# Mumbai, day: crew 6h*850=5100, cast 2*1200+10*45=2850, triggers 10*45+3200=3650
f = calculate_deterministic_budget(bd, "MUMBAI_OTT")
assert f["crew_cost_usd"] == 5100, f
assert f["cast_cost_usd"] == 2850, f
assert f["triggers_total_usd"] == 3650, f
assert f["total_estimated_cost_usd"] == 11600, f
assert f["total_local"] == 11600 * 84 and f["currency_code"] == "INR" and f["fx_from_usd"] == 84, f
assert f["shoot_days_required"] == 0.6, f

# Overrides win; night multiplier applies to crew only; None leaves Gemini's value.
night = apply_overrides(bd, time_of_day="NIGHT", background_extras_count=0, int_ext=None)
assert night.int_ext == "EXT" and night.background_extras_count == 0
f = calculate_deterministic_budget(night, "MUMBAI_OTT")
assert f["is_night"] and f["crew_cost_usd"] == round(6 * 850 * 1.35), f
assert f["cast_cost_usd"] == 2400, f

# Unknown hub is an error, not a silent Mumbai fallback.
try:
    calculate_deterministic_budget(bd, "ATLANTIS")
    raise AssertionError("expected 400")
except HTTPException as e:
    assert e.status_code == 400


# --- Scene input guardrails
def rejected(text):
    try:
        validate_scene_text(text)
        return None
    except HTTPException as e:
        assert e.status_code == 422
        return e.detail

GOOD = """EXT. MARINE DRIVE - NIGHT

Rain lashes the promenade. KABIR weaves a motorcycle through stalled cars as sirens wail.

KABIR
We lose the witness tonight!"""

assert rejected(GOOD) is None
assert rejected("  \n" + GOOD + "\n\n") is None                          # surrounding whitespace is fine
assert rejected(GOOD.replace("EXT. MARINE", "INT./EXT. MARINE")) is None
assert rejected(GOOD.replace("EXT. MARINE", "I/E MARINE")) is None
assert "too short" in rejected("EXT. BEACH - DAY\nWaves.")
assert "too long" in rejected(GOOD + "\nKabir runs." * 2000)
assert "scene heading" in rejected("Once upon a time there was a princess who lived in a tall tower by the sea.")
assert "EXTRAS" not in GOOD and rejected(GOOD.replace("EXT. MARINE DRIVE - NIGHT", "EXTRAS gather near the drive")) # no slugline
assert "2 scene headings" in rejected(GOOD + "\n\nINT. POLICE STATION - NIGHT\n\nA phone rings.")
assert "control characters" in rejected(GOOD + "\x00")
assert "action or dialogue" in rejected("EXT. MARINE DRIVE - NIGHT\n\n1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21")
assert "symbols" in rejected("EXT. CODE - DAY\n\n" + "if (x) { y = z[0] + 1; } " * 3 + "the hero runs away from the big scary dog now {};{};{};{};{};{};{};{};{};{};")

# Cost items must quote the scene; unanchored ones are dropped with a visible note.
anchored = bd.model_copy(update={"cost_triggers": [trigger("STUNTS_PYRO"), trigger("VFX_CGI").model_copy(update={"exact_script_quote": "not in scene"})]})
kept = keep_quoted_triggers(anchored, "x marks the spot")
assert [t.category for t in kept.cost_triggers] == ["STUNTS_PYRO"] and "1 suggested cost item" in kept.schedule_hazard_warnings[-1]

# --- Location pricing: rate card x severity + extra hours x crew rate; the LLM never supplies money.
audit = LocationAuditSchema(
    is_location_photo=True, rejection_reason="", location_summary="", compatibility_score=70, practical_vs_vfx_verdict="",
    hazards=[
        LocationHazard(hazard_type="LIGHTING_BLACKOUT", severity="HIGH", visual_evidence="", mitigation_equipment_needed="", extra_setup_hours=2),
        LocationHazard(hazard_type="ACOUSTIC_ADR", severity="LOW", visual_evidence="", mitigation_equipment_needed="", extra_setup_hours=0),
    ],
)
p = price_location_audit(audit, "MUMBAI_OTT")
assert [h["cost_usd"] for h in p["hazards"]] == [round(1500 * 1.75 + 2 * 850), 400], p
assert p["total_extra_usd"] == 4325 + 400 and p["total_local"] == 4725 * 84 and p["total_extra_hours"] == 2, p
assert price_location_audit(audit, "TOKYO_OTT")["currency_code"] == "JPY"
try:
    price_location_audit(audit, "ATLANTIS")
    raise AssertionError("expected 400")
except HTTPException as e:
    assert e.status_code == 400

# --- Image signature check ignores the filename/content-type and reads the bytes.
assert image_mime(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
assert image_mime(b"\x89PNG\r\n\x1a\nrest") == "image/png"
assert image_mime(b"RIFF\x00\x00\x00\x00WEBPrest") == "image/webp"
for bad in (b"hello, I am a text file", b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024)):
    try:
        image_mime(bad)
        raise AssertionError("expected 422")
    except HTTPException as e:
        assert e.status_code == 422

print("budget, guardrail and location checks passed")
