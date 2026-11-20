import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  RotateCcw,
  CloudSun,
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Droplets,
  WindIcon,
  Wrench,
  History,
  Info,
  Fan,
  Clock3,
  CalendarRange,
  Sparkles,
  ArrowLeft,
  Download,
} from "lucide-react";
import { useApi } from "../lib/api";
import { useMeta } from "../lib/context";
import type { Day, Live, Meta, StrategyKey, WeatherNow } from "../lib/types";
import EChart, {
  axisCommon,
  baseTooltip,
  ttRow,
  ttTitle,
  type EChartsOption,
} from "../components/EChart";
import {
  COLD_START,
  STRATEGY,
  decisionLabel,
  statusInfo,
} from "../lib/constants";
import {
  cx,
  fmtDateK,
  fmtKwh,
  fmtMin,
  fmtPct,
  hm,
  josa,
  pctSaving,
} from "../lib/format";
import {
  MODE,
  buildingAt,
  buildingFromLive,
  type BuildingState,
} from "../lib/thermal";
import BuildingView, {
  MapLegend,
  TimeScrubber,
} from "../components/BuildingView";
import Gantt, {
  DecisionIcon,
  GanttLegend,
  decisionMinute,
} from "../components/Gantt";
import { RoomDetails, RoomHero, type RoomNow } from "../components/RoomDrawer";
import {
  Badge,
  Button,
  Disclosure,
  DisclosureList,
  ErrorBox,
  Figure,
  LegendItem,
  Loading,
  PageSkeleton,
  Popover,
  Segmented,
  Skeleton,
  ToggleChip,
  btnCls,
  inputBase,
} from "../components/ui";
import { SectionTabs } from "../components/Layout";

export default function Overview() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta();
  const [params, setParams] = useSearchParams();
  const at = params.get("at");
  const live = useApi<Live>(
    at ? `/api/live?at=${encodeURIComponent(at)}` : "/api/live",
    { maxAgeMs: 30_000, refreshMs: at ? undefined : 60_000 },
  );
  const date = live.data?.now.date;
  const day = useApi<Day>(date ? `/api/day/${date}` : null);
  const weather = useApi<WeatherNow>("/api/weather", { maxAgeMs: 10 * 60_000 });
  // the selected room lives in the URL (?room=407): the page shows that room instead of the whole building
  const drawerRoom = params.get("room");
  const setDrawerRoom = useCallback(
    (r: string | null) =>
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (r) n.set("room", r);
          else n.delete("room");
          return n;
        },
        { replace: false },
      ),
    [setParams],
  );
  const [viewMinute, setViewMinute] = useState<number | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [showOdus, setShowOdus] = useState(false);

  // scrubbed minute belongs to one reference date; reset when the date changes
  const key = `${date}|${at ?? ""}`;
  if (viewKey !== key) {
    setViewKey(key);
    setViewMinute(null);
  }
  const onScrub = useCallback((m: number) => setViewMinute(m), []);

  if (live.error)
    return (
      <ErrorBox
        title="건물 상태를 불러오지 못했습니다"
        error={live.error}
        onRetry={live.reload}
      />
    );
  if (metaError && !meta)
    return (
      <ErrorBox
        title="기본 정보를 불러오지 못했습니다"
        error={metaError}
        onRetry={reloadMeta}
      />
    );
  if (!meta || !live.data)
    return <PageSkeleton label="건물 상태를 불러오는 중…" />;

  const L = live.data;
  const now = L.now;
  const D = day.data?.date === now.date ? day.data : undefined;
  const scrubbing = viewMinute != null && viewMinute !== now.minute && !!D;
  const shown = scrubbing
    ? buildingAt(D!, meta, viewMinute!)
    : buildingFromLive(L, meta, D);
  const minute = scrubbing ? viewMinute! : now.minute;
  const ref: "now" | "replay" | "scrub" = scrubbing
    ? "scrub"
    : at
      ? "replay"
      : "now";
  const drawerNow = drawerRoom
    ? roomNow(
        shown,
        meta,
        drawerRoom,
        minute,
        scrubbing
          ? minute > now.minute
            ? "계획"
            : "기록"
          : at
            ? "재현"
            : "현재",
      )
    : undefined;

  return (
    <div>
      {/* the page's answer: one sentence from the data + three key numbers */}
      <header className="mb-3 flex items-center justify-between gap-4 px-[15px] ">
        <h1 className="text-[26px] leading-[1.2] font-bold tracking-[-0.025em] text-[#2b3447]">
          현재 운영 현황
        </h1>

        <div className="hidden shrink-0 lg:block">
          <SectionTabs />
        </div>
      </header>

      {drawerRoom && meta.rooms[drawerRoom] ? (
        /* one room in focus (mock 1): the room card, its status and its chart, then the day's detail */
        <section aria-labelledby="room-focus-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDrawerRoom(null)}
              >
                <ArrowLeft size={14} aria-hidden /> 건물 전체
              </Button>
              <h2 id="room-focus-title" className="sr-only">
                {drawerRoom}호 상세
              </h2>
              <RoomPicker
                meta={meta}
                state={shown}
                value={drawerRoom}
                onChange={setDrawerRoom}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cx(
                  "tnum rounded-full px-3 py-1 text-[13.5px] font-semibold",
                  scrubbing ? "bg-brand text-white" : "bg-[#edf1f7] text-ink-2",
                )}
              >
                {fmtMin(minute)}{" "}
                {scrubbing
                  ? minute > now.minute
                    ? "계획"
                    : "기록"
                  : at
                    ? "재현"
                    : "현재"}
              </span>
              {D && (
                <a
                  href={`/api/export/plan.csv?date=${D.date}&strategy=ai`}
                  className={btnCls("ghost", "sm")}
                  download
                >
                  <Download size={14} aria-hidden /> 운전 계획 CSV
                </a>
              )}
            </div>
          </div>
          <RoomHero
            day={D}
            meta={meta}
            room={drawerRoom}
            now={drawerNow}
            layout="page"
          />
          {D ? (
            <div className="mt-6">
              <RoomDetails day={D} meta={meta} room={drawerRoom} />
            </div>
          ) : day.error ? (
            <div className="mt-6">
              <ErrorBox error={day.error} onRetry={day.reload} />
            </div>
          ) : (
            <Skeleton className="mt-6 h-[120px]" />
          )}
        </section>
      ) : (
        /* hero: the building as floor plates */
        <section
          data-tour="ov-building"
          className="rounded-[14px] border border-line bg-surface"
          aria-labelledby="bv-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-7 pt-6">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2
                id="bv-title"
                className="text-[17px] font-[650] tracking-[-0.01em] text-ink"
              >
                IT관 3·4층
              </h2>
              <span
                className={cx(
                  "tnum rounded-full px-3 py-1 text-[13.5px] font-semibold",
                  scrubbing ? "bg-brand text-white" : "bg-[#edf1f7] text-ink-2",
                )}
              >
                {fmtMin(minute)}{" "}
                {scrubbing
                  ? minute > now.minute
                    ? "계획"
                    : "기록"
                  : at
                    ? "재현"
                    : "현재"}
              </span>
              {scrubbing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setViewMinute(null)}
                >
                  <RotateCcw size={13} aria-hidden />{" "}
                  {at ? "기준 시각으로" : "지금으로"}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleChip
                pressed={showOdus}
                onChange={setShowOdus}
                title="실외기 3대와 배관, 지금 전력을 평면도에 겹쳐 봅니다"
              >
                <Fan size={14} aria-hidden /> 실외기
              </ToggleChip>
              <ReplayControl
                now={now}
                at={at}
                semester={meta.semester}
                onSet={(v) =>
                  setParams((prev) => {
                    const n = new URLSearchParams(prev);
                    if (v) n.set("at", v);
                    else n.delete("at");
                    return n;
                  })
                }
              />
            </div>
          </div>
          <div className="px-5 pt-4 pb-2">
            <BuildingView
              meta={meta}
              state={shown}
              onRoomClick={setDrawerRoom}
              selected={drawerRoom}
              showOdus={showOdus}
            />
          </div>
          <div
            data-tour="ov-time"
            className="border-t border-line px-7 pt-9 pb-6"
          >
            {D ? (
              <TimeScrubber
                day={D}
                meta={meta}
                minute={minute}
                nowMinute={now.minute}
                onChange={onScrub}
                refLabel={at ? "기준 시각" : "지금"}
              />
            ) : day.error ? (
              <ErrorBox error={day.error} onRetry={day.reload} />
            ) : (
              <Skeleton className="h-[40px]" />
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <MapLegend meta={meta} />
              <span className="text-[13px] text-ink-3">
                강의실을 누르면 그 강의실 화면으로 바뀝니다
              </span>
            </div>
          </div>
        </section>
      )}

      {/* everything else is one click away */}
      <DisclosureList className="mt-6" title="자세히 보기" hideTitle>
        <Disclosure
          icon={<CalendarRange size={16} aria-hidden />}
          title={
            at ? `${fmtDateK(now.date)} 운전 타임라인` : "오늘 운전 타임라인"
          }
          summary={D ? `강의 ${D.sessions.length}건` : undefined}
        >
          {D ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <GanttLegend primary="ai" compact />
                <Link
                  to={`/schedule?date=${now.date}`}
                  className={btnCls("secondary", "sm")}
                >
                  스케줄 화면에서 보기
                </Link>
              </div>
              <Gantt
                day={D}
                meta={meta}
                primary="ai"
                compact
                nowMinute={minute}
                onRoomClick={setDrawerRoom}
                selectedRoom={drawerRoom}
              />
              <HourlyEnergy day={D} nowMinute={now.minute} />
            </div>
          ) : day.error ? (
            <ErrorBox error={day.error} onRetry={day.reload} />
          ) : (
            <Loading label="운전 기록을 불러오는 중…" />
          )}
        </Disclosure>
        <Disclosure
          icon={<Sparkles size={16} aria-hidden />}
          title={at ? "AI 판단과 자동 조치" : "오늘 AI 판단과 자동 조치"}
          summary={D ? `${feedCount(D)}건` : undefined}
        >
          <Feed day={D} nowMinute={now.minute} onOpen={setDrawerRoom} />
        </Disclosure>
        <Disclosure
          icon={<CloudSun size={16} aria-hidden />}
          title={at ? "재현 시각 외기와 예보" : "외기와 예보"}
          summary={`${L.outdoor.t.toFixed(1)}℃, 습도 ${Math.round(L.outdoor.rh)}%`}
        >
          <WeatherDetail
            live={L}
            weather={weather.data}
            day={D}
            replay={!!at}
          />
        </Disclosure>
      </DisclosureList>
    </div>
  );
}

// ---------------------------------------------------------------- the one-sentence summary (computed, no LLM)

const MODE_VERB: Record<string, string> = {
  heat: "난방하며",
  cool: "냉방하며",
  air: "송풍(외기 냉방)으로 식히며",
};

/** "지금 강의실 2곳을 난방하며 수업 중인 2곳은 모두 쾌적하고, 다음 AI 조치는 13:11 405호 최적 기동입니다." */
function summarize(
  state: BuildingState,
  meta: Meta,
  day: Day | undefined,
  minute: number,
  ref: "now" | "replay" | "scrub",
): string {
  const lo = meta.settings.comfort_low;
  const hi = meta.settings.comfort_high;
  const running = state.rooms.filter((r) => r.mode !== "off");
  const occupied = state.rooms.filter((r) => r.session);
  const outBand = occupied.filter(
    (r) => Number.isFinite(r.ta) && (r.ta < lo || r.ta > hi),
  );
  const modes = [...new Set(running.map((r) => r.mode))];
  const prefix =
    ref === "now"
      ? "지금 "
      : ref === "replay"
        ? `${fmtMin(minute)} 현재 `
        : `${fmtMin(minute)}에는 `;
  const rooms = (rs: { room: string }[]) =>
    rs.map((r) => `${r.room}호`).join(", ");

  let a = "";
  if (running.length) {
    a = `강의실 ${running.length}곳을 ${modes.length === 1 ? MODE_VERB[modes[0]] : "가동하며"} `;
    if (!occupied.length) a += "수업 전 미리 맞추고 있고";
    else if (!outBand.length)
      a +=
        occupied.length === 1
          ? `수업 중인 ${occupied[0].room}호는 쾌적하고`
          : `수업 중인 ${occupied.length}곳은 모두 쾌적하고`;
    else a += `수업 중인 ${rooms(outBand)}가 아직 쾌적 범위 밖이고`;
  } else if (occupied.length) {
    a = outBand.length
      ? `수업 중인 ${rooms(outBand)}가 쾌적 범위 밖이고`
      : occupied.length === 1
        ? `수업 중인 ${occupied[0].room}호가 가동 없이도 쾌적하고`
        : `수업 중인 ${occupied.length}곳이 가동 없이도 쾌적하고`;
  } else {
    a = "모든 강의실이 정지해 있고";
  }

  let b = "이후 예정된 AI 조치는 없습니다.";
  if (day) {
    const plan = day.strategies.ai?.plan ?? {};
    const next = day.decisions
      .map((d) => ({ d, m: decisionMinute(d, plan[d.room]) }))
      .filter((x) => x.m > minute)
      .sort((x, y) => x.m - y.m)[0];
    if (next)
      b = `다음 AI 조치는 ${fmtMin(next.m)} ${next.d.room}호 ${decisionLabel(next.d.type)}입니다.`;
    else if (!day.sessions.some((s) => hm(s.end) > minute))
      b = "오늘 남은 강의는 없습니다.";
  } else {
    b = "";
  }
  return `${prefix}${a}${b ? `, ${b}` : "."}`;
}

/** What the drawer shows under "지금": this room's state and its outdoor unit at the shown minute. */
function roomNow(
  state: BuildingState,
  meta: Meta,
  room: string,
  minute: number,
  label: string,
): RoomNow | undefined {
  const r = state.rooms.find((x) => x.room === room);
  if (!r) return undefined;
  const oduId = meta.rooms[room]?.odu;
  const odu = oduId ? state.odus[oduId] : undefined;
  return {
    ...r,
    minute,
    label,
    odu: odu && oduId ? { id: oduId, ...odu } : undefined,
  };
}

// ---------------------------------------------------------------- room picker (switch rooms without going back)

function RoomPicker({
  meta,
  state,
  value,
  onChange,
}: {
  meta: Meta;
  state: BuildingState;
  value: string;
  onChange: (r: string) => void;
}) {
  const rooms = Object.values(meta.rooms).sort(
    (a, b) => b.floor - a.floor || a.id.localeCompare(b.id),
  );
  return (
    <div
      className="thin-scroll flex max-w-full gap-1 overflow-x-auto"
      role="group"
      aria-label="강의실 선택"
    >
      {rooms.map((r) => {
        const st = state.rooms.find((x) => x.room === r.id);
        const on = r.id === value;
        const run = st && st.mode !== "off";
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(r.id)}
            className={cx(
              "tnum inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
              on
                ? "border-brand bg-brand-bg text-brand-ink"
                : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            {run && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: MODE[st!.mode].color }}
                aria-hidden
              />
            )}
            {r.id}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- key figures (basis on click)

function KeyFigures({ L, at }: { L: Live; at: boolean }) {
  const ds = L.date_summary;
  const so = L.kwh_so_far;
  const ai = so.ai;
  const svFixed = pctSaving(so.fixed, ai);
  // compare whole days (cold starts are per day), not the so-far totals
  const dayDiff = ds.strategies.ai.kwh - ds.strategies.rule.kwh;
  const coldRule = ds.strategies.rule.cold_starts;
  const coldAi = ds.strategies.ai.cold_starts;
  const when = at ? "이 시각까지" : "지금까지";
  const row = (k: StrategyKey, v: string, strong = false) => (
    <div
      key={k}
      className={cx(
        "flex items-center justify-between gap-4 py-1",
        strong && "font-semibold text-ink",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: STRATEGY[k].color }}
          aria-hidden
        />
        {STRATEGY[k].label}
      </span>
      <span className="tnum">{v}</span>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-5">
      <Figure
        label={`${when} AI 전력`}
        value={fmtKwh(ai)}
        unit="kWh"
        accent={STRATEGY.ai.color}
        info={
          <>
            <p className="mb-2 text-[13.5px]">
              {when} 쓴 전력을 같은 시간표·날씨의 다른 운전 방식과 비교합니다.
              하루 전체 AI 예상은{" "}
              <b className="tnum font-semibold text-ink">
                {fmtKwh(ds.strategies.ai.kwh)} kWh
              </b>
              입니다.
            </p>
            {(["ai", "rule", "manual", "fixed"] as StrategyKey[]).map((k) =>
              row(k, `${fmtKwh(so[k])} kWh`, k === "ai"),
            )}
          </>
        }
      />
      <Figure
        label="고정 스케줄 대비"
        value={svFixed != null ? `−${svFixed.toFixed(1)}` : "–"}
        unit="%"
        info={
          <div className="space-y-2.5 text-[13.5px]">
            <p>
              고정 스케줄(평일 08:30–22:30)이었다면 {when}{" "}
              <b className="tnum font-semibold text-ink">
                {fmtKwh(so.fixed)} kWh
              </b>
              를 썼습니다. AI는 {fmtKwh(so.fixed - ai)} kWh 덜 썼습니다.
            </p>
            <div className="rounded-[10px] bg-well px-3 py-2.5">
              <div className="font-semibold text-ink">
                규칙 기반(10분 전 가동)과 하루 비교
              </div>
              <div className="tnum mt-1">
                {ds.sessions > 0 && coldRule != null && coldAi != null
                  ? `AI가 하루 ${fmtKwh(Math.abs(dayDiff))} kWh ${dayDiff > 0 ? "더 쓰지만" : "덜 쓰고"}, ${COLD_START.label}${josa(COLD_START.label, "은", "는")} 규칙 ${coldRule}/${ds.sessions}건, AI ${coldAi}/${ds.sessions}건입니다.`
                  : `AI가 하루 ${fmtKwh(Math.abs(dayDiff))} kWh ${dayDiff > 0 ? "더" : "덜"} 씁니다.`}
              </div>
              {dayDiff > 0 &&
                coldAi != null &&
                coldRule != null &&
                coldAi < coldRule && (
                  <div className="mt-1 text-ink-3">
                    더 쓴 전력은 수업 전에 미리 데운 몫입니다.
                  </div>
                )}
            </div>
          </div>
        }
      />
      <Figure
        label="강의 중 쾌적 유지율"
        value={
          ds.strategies.ai.comfort_pct != null
            ? ds.strategies.ai.comfort_pct.toFixed(1)
            : "–"
        }
        unit="%"
        align="right"
        info={
          <div className="space-y-2 text-[13.5px]">
            <p>
              강의 시간 중 실내온도가 쾌적 범위 안이었던 비율입니다(오늘 하루,
              지금 이후는 AI 계획 기준).
            </p>
            {(["ai", "rule", "manual"] as StrategyKey[]).map((k) =>
              row(k, fmtPct(ds.strategies[k].comfort_pct), k === "ai"),
            )}
            <div className="border-t border-line pt-2">
              계획·실행 정합성{" "}
              <b className="tnum font-semibold text-ink">
                {fmtPct(ds.match_rate)}
              </b>
              , 강의 {ds.sessions}건, 계획 반영 {fmtPct(ds.plan_coverage, 0)}
            </div>
          </div>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- replay another time (behind a popover)

function ReplayControl({
  now,
  at,
  semester,
  onSet,
}: {
  now: Live["now"];
  at: string | null;
  semester: { start: string; end: string };
  onSet: (v: string | null) => void;
}) {
  const [val, setVal] = useState(at ?? `${now.date}T${fmtMin(now.minute)}`);
  return (
    <>
      {at && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onSet(null);
            setVal("");
          }}
        >
          <RotateCcw size={13} aria-hidden /> 실시간으로
        </Button>
      )}
      <Popover
        label="다른 시점 재현"
        align="end"
        width={320}
        buttonClassName={btnCls("secondary", "sm")}
        button={
          <>
            <Clock3 size={14} aria-hidden /> 다른 시점
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (val) onSet(val);
          }}
        >
          <div>
            <label
              className="text-[14px] font-semibold text-ink"
              htmlFor="replay-at"
            >
              다른 시점 재현
            </label>
            <p className="mt-0.5 text-[13px] text-ink-3">
              학기 중 어느 시각이든 그때의 건물 상태를 다시 계산해 보여 줍니다.
            </p>
          </div>
          <input
            id="replay-at"
            name="replay-at"
            type="datetime-local"
            className={cx(inputBase, "tnum w-full")}
            value={val}
            min={`${semester.start}T00:00`}
            max={`${semester.end}T23:55`}
            step={300}
            onChange={(e) => setVal(e.target.value)}
          />
          <Button type="submit" variant="primary" className="w-full">
            이 시점 보기
          </Button>
        </form>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------- detail: hourly energy

function HourlyEnergy({ day, nowMinute }: { day: Day; nowMinute: number }) {
  const keys: StrategyKey[] = ["fixed", "rule", "ai"];
  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 40, right: 12, top: 12, bottom: 24 },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        formatter: (ps: unknown) => {
          const arr = ps as {
            seriesName: string;
            value: number;
            color: string;
            axisValue: string;
          }[];
          let h = ttTitle(
            `${arr[0]?.axisValue}시대${Number(arr[0]?.axisValue) * 60 > nowMinute ? " (계획)" : ""}`,
          );
          for (const p of arr)
            h += ttRow(p.color, p.seriesName, `${p.value.toFixed(2)} kWh`);
          return h;
        },
      },
      xAxis: {
        type: "category",
        data: hours.map(String),
        ...axisCommon,
        axisLabel: {
          ...axisCommon.axisLabel,
          formatter: (v: string) => `${v}시`,
        },
      },
      yAxis: {
        type: "value",
        ...axisCommon,
        axisLine: { show: false },
        splitNumber: 3,
      },
      series: keys.map((k) => ({
        name: STRATEGY[k].label,
        type: "line",
        step: "middle",
        showSymbol: false,
        lineStyle: { width: 2, color: STRATEGY[k].color },
        itemStyle: { color: STRATEGY[k].color },
        areaStyle: k === "ai" ? { color: "rgba(20,166,115,0.10)" } : undefined,
        z: k === "ai" ? 5 : 2,
        data: hours.map((h) => day.strategies[k]?.kwh_by_hour[h] ?? 0),
        ...(k === "fixed"
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: "#142033", width: 1, type: "solid" },
                label: { show: false },
                data: [
                  {
                    xAxis: String(
                      Math.min(23, Math.max(7, Math.floor(nowMinute / 60))),
                    ),
                  },
                ],
              },
            }
          : {}),
      })) as never,
    }),
    [day, nowMinute],
  );
  return (
    <div className="border-t border-line pt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-ink">
          시간대별 전력량 (kWh)
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {(["ai", "rule", "fixed"] as StrategyKey[]).map((k) => (
            <LegendItem
              key={k}
              color={STRATEGY[k].color}
              label={STRATEGY[k].label}
              kind="line"
            />
          ))}
          <LegendItem color="#142033" label="현재 시각" kind="line" />
        </span>
      </div>
      <EChart option={option} height={170} />
    </div>
  );
}

// ---------------------------------------------------------------- detail: weather

function skyIcon(sky: number, pty: number, size = 18) {
  if (pty === 1 || pty === 4 || pty === 5)
    return <CloudRain size={size} className="text-cool" aria-hidden />;
  if (pty === 2 || pty === 3 || pty === 6 || pty === 7)
    return <CloudSnow size={size} className="text-cool" aria-hidden />;
  if (sky === 1)
    return <Sun size={size} className="text-[#d98a00]" aria-hidden />;
  if (sky === 3)
    return <CloudSun size={size} className="text-ink-3" aria-hidden />;
  return <Cloud size={size} className="text-ink-3" aria-hidden />;
}

function skyLabel(sky: number, pty: number) {
  if (pty === 1) return "비";
  if (pty === 2) return "비/눈";
  if (pty === 3) return "눈";
  if (pty === 4) return "소나기";
  if (sky === 1) return "맑음";
  if (sky === 3) return "구름많음";
  return "흐림";
}

function WeatherDetail({
  live,
  weather,
  day,
  replay,
}: {
  live: Live;
  weather: WeatherNow | undefined;
  day: Day | undefined;
  replay: boolean;
}) {
  const now = live.now;
  const h0 = Math.floor(now.minute / 60);
  const key = `${now.date}T${String(h0).padStart(2, "0")}`;
  const kma = weather?.kma_hourly ?? {};
  const kmaKeys = Object.keys(kma).sort();
  const kmaCovers = kmaKeys.some((k) => k.startsWith(now.date));
  // KMA short-term forecast only covers the coming days; for other reference dates use that day's simulation weather.
  const hourly: Record<
    string,
    { t: number; rh: number; sky: number; pty: number; pop: number }
  > = kmaCovers
    ? kma
    : Object.fromEntries(
        (day?.weather.actual.t ?? []).map((t, h) => [
          `${now.date}T${String(h).padStart(2, "0")}`,
          {
            t,
            rh: day!.weather.actual.rh[h],
            sky: (day!.weather.actual.ghi[h] ?? 0) > 250 ? 1 : 3,
            pty: 0,
            pop: 0,
          },
        ]),
      );
  const keys = Object.keys(hourly).sort();
  const upcoming = keys.filter((k) => k >= key).slice(0, 10);
  const cur = hourly[keys.find((k) => k >= key) ?? ""];
  const nc = replay ? null : weather?.nowcast;
  const src = kmaCovers
    ? `기상청 단기예보${weather?.kma_base ? ` ${weather.kma_base.slice(4, 6)}/${weather.kma_base.slice(6, 8)} ${weather.kma_base.slice(8, 10)}시 발표` : ""}`
    : `${day?.weather.src_actual ?? "Open-Meteo"} 시간별 기온`;
  const temps = upcoming.map((k) => hourly[k].t);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <div className="flex items-center gap-3">
          {cur ? (
            skyIcon(cur.sky, cur.pty, 34)
          ) : (
            <CloudSun size={34} className="text-ink-3" aria-hidden />
          )}
          <div className="tnum text-[40px] leading-none font-[650] tracking-[-0.03em] text-ink">
            {live.outdoor.t.toFixed(1)}
            <span className="ml-0.5 text-[18px] font-medium text-ink-3">℃</span>
          </div>
        </div>
        <div className="mt-3 space-y-1 text-[13.5px] text-ink-2">
          <div className="flex items-center gap-1.5">
            <Droplets size={14} className="text-ink-3" aria-hidden /> 습도{" "}
            {Math.round(live.outdoor.rh)}%
            {cur && (
              <span>
                , {skyLabel(cur.sky, cur.pty)}
                {kmaCovers ? `, 강수 ${cur.pop}%` : ""}
              </span>
            )}
          </div>
          <div className="text-ink-3">
            {replay ? "재현 시각" : "지금"} {fmtMin(now.minute)},{" "}
            {live.outdoor.src}
          </div>
          {nc && (
            <div className="tnum text-ink-3">
              기상청 초단기실황 {nc.t.toFixed(1)}℃, 습도 {Math.round(nc.rh)}%,{" "}
              <WindIcon size={12} className="inline" aria-hidden /> {nc.wind}m/s
              ({nc.time.slice(11, 13)}시 관측)
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-2 text-[13px] text-ink-3">{src}</div>
        {upcoming.length > 0 ? (
          <>
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${upcoming.length}, minmax(0, 1fr))`,
              }}
            >
              {upcoming.map((k) => {
                const h = hourly[k];
                return (
                  <div
                    key={k}
                    className="flex flex-col items-center text-center"
                    title={`${skyLabel(h.sky, h.pty)}, 습도 ${h.rh}%${kmaCovers ? `, 강수확률 ${h.pop}%` : ""}`}
                  >
                    <span className="tnum text-[13px] text-ink-3">
                      {k.slice(11, 13)}시
                    </span>
                    <span className="my-1.5">{skyIcon(h.sky, h.pty, 17)}</span>
                    <span className="tnum text-[14px] font-semibold text-ink">
                      {Math.round(h.t)}°
                    </span>
                  </div>
                );
              })}
            </div>
            <svg
              className="mt-2 block h-[24px] w-full"
              viewBox={`0 0 ${upcoming.length * 10} 24`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <polyline
                fill="none"
                stroke="#8a94a3"
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                points={upcoming
                  .map(
                    (k, i) =>
                      `${i * 10 + 5},${21 - (tMax > tMin ? (hourly[k].t - tMin) / (tMax - tMin) : 0.5) * 18}`,
                  )
                  .join(" ")}
              />
            </svg>
          </>
        ) : weather ? (
          <p className="text-[13.5px] text-ink-3">
            이 시각 이후의 시간별 예보가 없습니다.
          </p>
        ) : (
          <Skeleton className="h-[80px]" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detail: decision feed

type FeedItem = {
  minute: number;
  kind: "decision" | "auto" | "history";
  room: string;
  title: string;
  detail: string;
  type?: string;
};

function feedItems(day: Day): FeedItem[] {
  const out: FeedItem[] = [];
  const plan = day.strategies.ai?.plan ?? {};
  for (const d of day.decisions) {
    out.push({
      minute: decisionMinute(d, plan[d.room]),
      kind: "decision",
      room: d.room,
      title: `${decisionLabel(d.type)}, ${d.title}`,
      detail: d.detail,
      type: d.type,
    });
  }
  for (const v of day.validation.sessions) {
    const info = statusInfo(v.status);
    if (info.group !== "auto") continue;
    out.push({
      minute: hm(v.start),
      kind: "auto",
      room: v.room,
      title: `${info.label}, ${v.title}`,
      detail: v.notes.join(" / "),
    });
  }
  for (const h of day.history) {
    if (!h.room) continue;
    if (!/자동|감지|수동|재전송|보정/.test(h.cause)) continue;
    out.push({
      minute: h.minute,
      kind: "history",
      room: h.room,
      title: `${h.device} ${h.state === "ON" ? "켬" : "끔"}`,
      detail: h.cause,
    });
  }
  return out.sort((a, b) => a.minute - b.minute);
}

function feedCount(day: Day) {
  return feedItems(day).length;
}

function Feed({
  day,
  nowMinute,
  onOpen,
}: {
  day: Day | undefined;
  nowMinute: number;
  onOpen: (r: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "decision" | "auto">("all");
  const items = useMemo<FeedItem[]>(() => (day ? feedItems(day) : []), [day]);
  const shown = items.filter(
    (i) =>
      filter === "all" ||
      (filter === "decision" ? i.kind === "decision" : i.kind !== "decision"),
  );
  const nDec = items.filter((i) => i.kind === "decision").length;
  const nAuto = items.length - nDec;

  if (!day) return <Loading />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          label="항목 종류"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `전체 ${items.length}` },
            { value: "decision", label: `AI 판단 ${nDec}` },
            { value: "auto", label: `자동 조치 ${nAuto}` },
          ]}
        />
        <span className="text-[13px] text-ink-3">
          항목을 누르면 그 강의실 상세가 열립니다
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="flex items-center gap-2 rounded-[10px] bg-well px-3.5 py-3 text-[13.5px] text-ink-2">
          <Info size={15} className="text-ink-3" aria-hidden />
          {filter === "auto"
            ? "오늘은 사람이 개입하거나 시스템이 바로잡은 이상 상황이 없었습니다."
            : "이 날은 강의가 없어 AI가 판단할 일이 없었습니다."}
        </div>
      ) : (
        <ol className="thin-scroll -mx-2 max-h-[440px] overflow-y-auto px-2">
          {shown.map((it, i) => {
            const future = it.minute > nowMinute;
            return (
              <li key={i} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  className="flex w-full gap-3 rounded-[10px] px-2 py-3 text-left transition-colors hover:bg-well"
                  onClick={() => onOpen(it.room)}
                >
                  <span
                    className={cx(
                      "tnum w-12 shrink-0 pt-0.5 text-[14px] font-semibold",
                      future ? "text-ink-3" : "text-ink",
                    )}
                  >
                    {fmtMin(it.minute)}
                  </span>
                  <span
                    className={cx(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      it.kind === "decision"
                        ? future
                          ? "bg-well text-ink-2 ring-1 ring-line-strong ring-inset"
                          : "bg-ink text-white"
                        : "bg-warn-bg text-[#c98500]",
                    )}
                    aria-hidden
                  >
                    {it.kind === "decision" ? (
                      <DecisionIcon type={it.type ?? ""} size={12} />
                    ) : it.kind === "auto" ? (
                      <Wrench size={12} strokeWidth={2.4} />
                    ) : (
                      <History size={12} strokeWidth={2.4} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                      <span className="tnum shrink-0 text-ink-2">
                        {it.room}
                      </span>
                      <span className="truncate">{it.title}</span>
                      {future && (
                        <Badge tone="outline" className="shrink-0">
                          예정
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-2">
                      {it.detail}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
