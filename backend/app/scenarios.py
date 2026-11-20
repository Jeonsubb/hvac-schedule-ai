"""Scenario planning for 2차·3차: the planning agent reads the whole dossier (timetable, weather, sensors,
opinions, tariff, policy), proposes a few whole-building setpoint scenarios with different goals, the
calculation engine simulates every scenario, and a fixed judge (electricity cost + comfort penalty)
picks one. The chosen scenario becomes the schedule adjustments the operator sees.

LLM proposals come from the agent model (Haiku); if the call fails the rule candidates alone are used
and the result says so (`ai: false`). Nothing here invents numbers: every kWh / 원 / PMV is the engine's.
"""
from __future__ import annotations

import json
import logging
from datetime import date

from . import agents, planning, service
from .store import get_store

log = logging.getLogger(__name__)

SCENARIO_SCHEMA = {
    "type": "object",
    "properties": {
        "scenarios": {
            "type": "array",
            "description": "서로 다른 목표의 시나리오 2~3개 (3개 초과 금지)",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "짧은 이름 (예: 오후 수업 집중 절감)"},
                    "goal": {"type": "string", "description": "이 시나리오가 노리는 것 한 구절"},
                    "rationale": {"type": "string", "description": "자료의 어떤 수치를 보고 이렇게 정했는지 2문장 이내"},
                    "setpoints": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"room": {"type": "string"}, "sp": {"type": "number"}},
                            "required": ["room", "sp"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["name", "goal", "rationale", "setpoints"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["scenarios"],
    "additionalProperties": False,
}


def _snap(ds: dict, v: float) -> float:
    v = round(round(float(v) * 2) / 2, 1)
    return min(max(v, ds["lo"]), ds["hi"])


def _rule_candidates(ds: dict) -> list[dict]:
    """Four fixed candidates around the current plan: keep, save, comfort, balance."""
    key = ds["key"]
    hot = agents.complaint_rooms(ds)
    quiet = [r for r in ds["rooms"] if r not in hot]
    base = dict(ds["base_sp"])
    lab = "난방" if ds["season"] == "heat" else "냉방"

    def with_(changes: dict) -> dict:
        return {**base, **changes}

    save = with_({r: agents._step(ds, r, -1) for r in quiet})
    comfort = with_({r: agents._step(ds, r, 2) for r in hot})
    balance = with_({**{r: agents._step(ds, r, 1) for r in hot},
                     **{r: agents._step(ds, r, -1) for r in quiet if (agents._pmv_drop(ds, r, agents._step(ds, r, -1)) or 0) <= 0.1}})
    out = [
        {"id": "keep", "name": "현재 계획 유지", "goal": "바꾸지 않음", "source": "rule",
         "rationale": f"지금 설정({', '.join(f'{r} {base[r]}℃' for r in ds['rooms'][:4])}{' …' if len(ds['rooms']) > 4 else ''})을 그대로 둡니다.",
         "setpoints": base},
        {"id": "save", "name": "절감 우선", "goal": "의견 없는 강의실 전부 0.5℃ 아끼기", "source": "rule",
         "rationale": f"의견이 없는 {len(quiet)}곳의 {lab} 설정을 0.5℃ 낮춥니다. 의견이 반복된 곳은 그대로 둡니다.", "setpoints": save},
        {"id": "comfort", "name": "쾌적 우선", "goal": "의견 반복 강의실 1℃ 보정", "source": "rule",
         "rationale": (f"'춥다/덥다'가 반복된 {', '.join(sorted(hot))}호를 1℃ 보정하고 나머지는 유지합니다." if hot else "반복 의견이 없어 현재 계획과 같습니다."),
         "setpoints": comfort},
        {"id": "balance", "name": "균형", "goal": "반복 의견 0.5℃ 보정 + 체감 변화 작은 곳 절감", "source": "rule",
         "rationale": "의견이 반복된 곳은 0.5℃ 보정하고, 0.5℃ 낮춰도 PMV가 0.1 넘게 떨어지지 않는 강의실만 절감합니다.", "setpoints": balance},
    ]
    seen = set()
    uniq = []
    for c in out:
        sig = json.dumps(c["setpoints"], sort_keys=True)
        if sig in seen:
            continue
        seen.add(sig)
        uniq.append(c)
    return uniq


def _llm_candidates(ds: dict) -> list[dict]:
    from . import ai

    ai._charge()
    lab = "난방" if ds["season"] == "heat" else "냉방"
    system = (
        "당신은 ON:D의 계획 에이전트입니다. 건물 관리자가 볼 수 있게 한국어로 씁니다.\n"
        "아래 자료(시간표, 예보, 시뮬레이터 결과, 재실자 의견, 재실 인원, CO₂, 요금, 정책)를 종합해 서로 다른 목표를 가진 "
        f"{lab} 설정온도 시나리오를 최대 3개 제안하세요. 각 시나리오는 수업이 있는 모든 강의실({', '.join(ds['rooms'])})의 설정온도를 포함합니다.\n"
        "규칙:\n"
        f"- 설정온도는 {ds['lo']}~{ds['hi']}℃ 안, 0.5℃ 단위입니다.\n"
        "- 시나리오끼리는 목표가 달라야 합니다(예: 요금 최소, 반복 의견 해소, 오후 일사 활용, 인원 많은 수업 우선).\n"
        "- rationale에는 자료에 있는 수치(kWh, 원, PMV, 의견 건수, 인원, ℃)만 인용합니다. 지어내지 않습니다.\n"
        "- 시뮬레이터가 각 시나리오를 다시 계산하고 판정은 '요금 + 쾌적 가중치 × PMV 악화'로 따로 합니다. 당신은 후보만 냅니다.\n\n"
        "자료:\n" + agents.dossier_text(ds)
    )
    resp = ai.client().with_options(timeout=45.0, max_retries=1).messages.create(
        model=agents.AGENT_MODEL,
        max_tokens=2500,
        system=system,
        messages=[{"role": "user", "content": "시나리오를 제안하세요."}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCENARIO_SCHEMA}},
    )
    raw = json.loads(ai._text(resp)).get("scenarios") or []
    out = []
    for i, s in enumerate(raw[:3]):
        sps = dict(ds["base_sp"])
        for x in s.get("setpoints") or []:
            r = str(x.get("room", "")).replace("호", "").strip()
            if r in sps:
                sps[r] = _snap(ds, x.get("sp", sps[r]))
        out.append({"id": f"llm{i + 1}", "name": str(s.get("name") or f"에이전트 안 {i + 1}")[:40], "goal": str(s.get("goal") or "")[:60],
                    "rationale": str(s.get("rationale") or "")[:400], "source": "llm", "setpoints": sps})
    return out


class Planner:
    """Three steps the run can report one by one: propose → simulate → choose."""

    def __init__(self, tier: int, d: date, ctx: service.Ctx, use_ai: bool = True):
        self.tier, self.d, self.use_ai = tier, d, use_ai
        # like the negotiation: plan from the day without the AI setpoint decisions already made for this same
        # period, so running the tier again reaches the same scenario instead of moving setpoints another step
        import copy

        first = agents._dates_for(tier, d, ctx)[0].isoformat()
        self.ctx = copy.copy(ctx)
        self.ctx.adjustments = [a for a in getattr(ctx, "adjustments", [])
                                if not (a.get("origin") == "agents" and a.get("tier") == tier and a.get("date_from") == first)]
        self.ds: dict = {}
        self.dates: list[date] = []
        self.cands: list[dict] = []
        self.ai_ok = False
        self.note: str | None = None
        self.chosen: dict | None = None
        self.adjustment_ids: list[str] = []

    # -- step 1: the agent reads everything and proposes
    def propose(self) -> str:
        self.ds = agents.build_dossier(self.tier, self.d, self.ctx)
        self.dates = [date.fromisoformat(x) for x in self.ds["dates"]]
        self.cands = _rule_candidates(self.ds)
        if self.use_ai:
            try:
                llm = _llm_candidates(self.ds)
                sigs = {json.dumps(c["setpoints"], sort_keys=True) for c in self.cands}
                added = 0
                for c in llm:
                    sig = json.dumps(c["setpoints"], sort_keys=True)
                    if sig in sigs:
                        c["note"] = "규칙 후보와 같은 설정"
                    sigs.add(sig)
                    self.cands.append(c)
                    added += 1
                self.ai_ok = True
                from . import ai

                ai.record_status(True)
            except Exception as e:  # the run must finish: rule candidates only
                self.note = f"에이전트(LLM) 제안 실패: {type(e).__name__}"
                log.warning("scenario LLM failed: %s: %s", type(e).__name__, e)
        n_llm = sum(1 for c in self.cands if c["source"] == "llm")
        n_rule = len(self.cands) - n_llm
        src = (f"자료 {len(self.ds['rooms'])}개 강의실 · 의견 {sum(b.get('n', 0) for b in self.ds['feedback'].values())}건 · "
               f"예보 {len(self.ds['weather'])}일 · 요금 {self.ds['rate']}원/kWh 종합")
        if self.ai_ok:
            return f"{src} → 에이전트 제안 {n_llm}개 + 규칙 후보 {n_rule}개"
        return f"{src} → 규칙 후보 {n_rule}개 ({self.note or 'LLM 미사용'})"

    # -- step 2: the engine simulates each scenario
    def simulate(self) -> str:
        key = self.ds["key"]
        hot = agents.complaint_rooms(self.ds)
        for c in self.cands:
            extra = {r: {key: sp} for r, sp in c["setpoints"].items() if abs(sp - self.ds["base_sp"].get(r, sp)) > 1e-6}
            ev = planning.evaluate(self.dates, self.ctx, extra, self.ds["feedback"])
            score = 0.0
            for r in self.ds["rooms"]:
                rr = ev["rooms"].get(r)
                if rr:
                    score += agents._room_score(self.ds, r, {"kwh": rr["kwh"], "pmv": rr["pmv"]}, hot, len(self.dates))
            c["changes"] = sorted(extra)
            c["eval"] = {"kwh": ev["kwh"], "cost_krw": ev["cost_krw"], "pmv_mean": ev["pmv_mean"], "cold_rooms": ev["cold_rooms"],
                         "hot_rooms": ev["hot_rooms"], "complaints_addressed": ev["complaints_addressed"], "cold_starts": ev["cold_starts"]}
            c["score"] = round(score)
        lo = min(c["eval"]["kwh"] for c in self.cands)
        hi = max(c["eval"]["kwh"] for c in self.cands)
        return f"시나리오 {len(self.cands)}개를 {len(self.dates)}일 × 강의실 {len(self.ds['rooms'])}곳 열모델로 계산 · 전력 {lo:,.1f}~{hi:,.1f} kWh"

    # -- step 3: the judge picks; the pick becomes adjustments
    def choose(self) -> str:
        ds = self.ds
        key = ds["key"]
        # lowest cost + comfort score; on a tie the agent's proposal is credited over the fixed rule
        best = min(self.cands, key=lambda c: (c["score"], 0 if c["source"] == "llm" else 1))
        self.chosen = best
        keep = next(c for c in self.cands if c["id"] == "keep")
        changed = {r: sp for r, sp in best["setpoints"].items() if abs(sp - ds["base_sp"].get(r, sp)) > 1e-6}
        lab = "난방" if ds["season"] == "heat" else "냉방"
        st = get_store()
        # the pick supersedes rule-made setpoint proposals for the same rooms and period
        for a in st.list_items("adjustment"):
            if (a.get("status") == "pending" and a.get("kind") == "setpoint" and a.get("origin") != "agents"
                    and set(a.get("rooms", [])) & set(ds["rooms"]) and a["date_from"] <= ds["dates"][-1] and a["date_to"] >= ds["dates"][0]):
                st.put_item("adjustment", a["id"], {**a, "status": "rejected", "decided_at": service.now_kst().isoformat(timespec="seconds"),
                                                    "decided_by": "시나리오 선택안으로 대체"})
        groups: dict = {}
        for r, sp in sorted(changed.items()):
            groups.setdefault(sp, []).append(r)
        base_ev, best_ev = keep["eval"], best["eval"]
        self.adjustment_ids = []
        for sp, rooms in sorted(groups.items()):
            olds = sorted({ds["base_sp"][r] for r in rooms})
            auto_ok = all(abs(sp - ds["base_sp"][r]) <= 0.5 + 1e-6 for r in rooms)
            kb = sum(planning.evaluate(self.dates, self.ctx, None, None)["rooms"].get(r, {}).get("kwh", 0) for r in rooms)
            ev_rooms = planning.evaluate(self.dates, self.ctx, {r: {key: sp} for r in rooms}, ds["feedback"])["rooms"]
            ka = sum(ev_rooms.get(r, {}).get("kwh", 0) for r in rooms)
            dkr = round(ka - kb, 2)
            adj = {
                "id": f"T{self.tier}-{ds['dates'][0]}-scenario-{str(sp).replace('.', '_')}", "tier": self.tier, "origin": "agents", "kind": "setpoint",
                "auto_ok": auto_ok,
                "title": f"{'·'.join(rooms)}호 {lab} {'/'.join(f'{x:.1f}' for x in olds)}℃ → {sp:.1f}℃ (시나리오 '{best['name']}')",
                "reason": (f"시나리오 {len(self.cands)}개를 열모델로 계산해 요금+쾌적 점수가 가장 낮은 '{best['name']}'을 골랐습니다. "
                           + best["rationale"] + ("" if auto_ok else " 한 번에 0.5℃를 넘게 바꾸므로 자동 운전 모드에서도 담당자 승인을 기다립니다.")),
                "rooms": rooms, "date_from": ds["dates"][0], "date_to": ds["dates"][-1], "change": {key: sp},
                "impact": {"kwh": dkr, "cost_krw": round(dkr * ds["rate"]), "pmv_before": base_ev["pmv_mean"], "pmv_after": best_ev["pmv_mean"],
                           "note": f"{len(self.dates)}일 AI 운전 재시뮬레이션"},
                "evidence": [{"source": "simulator", "text": f"'{best['name']}' 전체: {best_ev['kwh']} kWh, {best_ev['cost_krw']:,}원, PMV {best_ev['pmv_mean']} (현재 계획 {base_ev['kwh']} kWh, PMV {base_ev['pmv_mean']})"}]
                            + [{"source": "feedback", "text": f"{r}호 최근 의견 {ds['feedback'][r]['n']}건, 평균 {ds['feedback'][r]['mean']:+.1f}"}
                               for r in rooms if ds["feedback"].get(r, {}).get("n")][:3],
            }
            self.adjustment_ids.append(planning.upsert_proposal(adj)["id"])
        dk = round(best_ev["kwh"] - base_ev["kwh"], 1)
        dc = int(best_ev["cost_krw"] - base_ev["cost_krw"])
        pick = f"'{best['name']}' 선택 ({'에이전트 제안' if best['source'] == 'llm' else '규칙 후보'}, 점수 {best['score']:,}원)"
        if best["id"] == "keep":
            return f"{pick} · 현재 계획이 요금+쾌적 점수에서 가장 낮아 바꾸지 않습니다."
        return (f"{pick} · 현재 계획 대비 전력 {dk:+.1f} kWh, 요금 {dc:+,}원, PMV {base_ev['pmv_mean']} → {best_ev['pmv_mean']} · "
                f"설정 바꾸는 강의실 {len(changed)}곳 → 조정안 {len(self.adjustment_ids)}건")

    def result(self) -> dict:
        return {"tier": self.tier, "dates": self.ds.get("dates"), "season": self.ds.get("season"), "key": self.ds.get("key"),
                "rate": self.ds.get("rate"), "comfort_won": self.ds.get("comfort_won"), "base_sp": self.ds.get("base_sp"),
                "complaint_rooms": sorted(agents.complaint_rooms(self.ds)) if self.ds else [],
                "scenarios": [{k: v for k, v in c.items()} for c in self.cands],
                "chosen": self.chosen["id"] if self.chosen else None, "ai": self.ai_ok, "note": self.note,
                "adjustment_ids": self.adjustment_ids}
