/**
 * QuestionFigureView: renders a QuestionFigure as inline, token-coloured SVG.
 *
 * Pure markup (no hooks, no client state), so it renders in server
 * components, client components and renderToStaticMarkup alike.
 *
 * Sizing: every chart uses a 360-unit-wide viewBox and 14-unit text, and the
 * SVG is capped at 28rem (448px). Text therefore renders at ~13px on a 343px
 * phone column and ~17px at the cap, never below the 13px floor in
 * docs/ui-redesign-demo.md for normal sheet widths.
 *
 * Accessibility: the SVG is role="img" with aria-label and <title> set to the
 * author's alt text; bar and line charts add an sr-only data table. Colour is
 * never the only signal: highlighted bars also get a heavy ink outline and a
 * bold value, and line series differ by dash pattern as well as colour.
 */
import type {
  QuestionFigure,
  QuestionFigureBar,
  QuestionFigureLine,
  QuestionFigureNormal,
  QuestionFigureVenn,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const WIDTH = 360;
const HEIGHT = 240;
const FONT = 14;

const SVG_CLASS =
  "block h-auto w-full max-w-[28rem] overflow-visible font-sans";
const TEXT = "fill-ink";
const MUTED_TEXT = "fill-ink-muted tabular-nums";

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

/** "Nice" tick values covering [min, max] with roughly `count` intervals. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ??
    10 * magnitude;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

function FigureShell({
  figure,
  className,
  viewBoxHeight = HEIGHT,
  children,
  after,
}: {
  figure: QuestionFigure;
  className?: string;
  viewBoxHeight?: number;
  children: React.ReactNode;
  after?: React.ReactNode;
}) {
  return (
    <figure
      className={cn("flex w-full flex-col gap-2", className)}
      data-figure-kind={figure.kind}
    >
      <svg
        aria-label={figure.alt}
        className={SVG_CLASS}
        fontSize={FONT}
        role="img"
        viewBox={`0 0 ${WIDTH} ${viewBoxHeight}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{figure.alt}</title>
        {children}
      </svg>
      {after}
      {figure.title ? (
        <figcaption className="type-caption">{figure.title}</figcaption>
      ) : null}
    </figure>
  );
}

function AxisTitles({
  xLabel,
  yLabel,
  plot,
}: {
  xLabel?: string;
  yLabel?: string;
  plot: { left: number; right: number; top: number; bottom: number };
}) {
  return (
    <>
      {xLabel ? (
        <text
          className={TEXT}
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={HEIGHT - 4}
        >
          {xLabel}
        </text>
      ) : null}
      {yLabel ? (
        <text
          className={TEXT}
          textAnchor="middle"
          transform={`translate(${FONT} ${(plot.top + plot.bottom) / 2}) rotate(-90)`}
        >
          {yLabel}
        </text>
      ) : null}
    </>
  );
}

function YAxis({
  ticks,
  scale,
  plot,
}: {
  ticks: number[];
  scale: (value: number) => number;
  plot: { left: number; right: number };
}) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            className="stroke-rule"
            strokeWidth={1}
            x1={plot.left}
            x2={plot.right}
            y1={scale(tick)}
            y2={scale(tick)}
          />
          <text
            className={MUTED_TEXT}
            dominantBaseline="middle"
            textAnchor="end"
            x={plot.left - 6}
            y={scale(tick)}
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

function plotBox(hasXLabel: boolean, hasYLabel: boolean) {
  return {
    left: hasYLabel ? 62 : 44,
    right: WIDTH - 8,
    top: 20,
    bottom: HEIGHT - (hasXLabel ? 46 : 26),
  };
}

function BarFigure({
  figure,
  className,
}: {
  figure: QuestionFigureBar;
  className?: string;
}) {
  const plot = plotBox(Boolean(figure.xLabel), Boolean(figure.yLabel));
  const maxValue = Math.max(...figure.bars.map((bar) => bar.value));
  const ticks = niceTicks(0, figure.yMax ?? (maxValue > 0 ? maxValue : 1));
  const top = figure.yMax ?? ticks[ticks.length - 1];
  const shownTicks = ticks.filter((tick) => tick <= top + 1e-9);
  const scale = (value: number) =>
    plot.bottom - (value / top) * (plot.bottom - plot.top);
  const slot = (plot.right - plot.left) / figure.bars.length;
  const barWidth = Math.min(slot * 0.7, 48);
  const labelEvery = Math.ceil(figure.bars.length / 12);
  const showValues = figure.bars.length <= 12;

  return (
    <FigureShell
      after={
        <table className="sr-only">
          <caption>{figure.title ?? "Chart data"}</caption>
          <thead>
            <tr>
              <th scope="col">{figure.xLabel ?? "Category"}</th>
              <th scope="col">{figure.yLabel ?? "Value"}</th>
            </tr>
          </thead>
          <tbody>
            {figure.bars.map((bar, index) => (
              <tr key={`${bar.label}-${index}`}>
                <th scope="row">{bar.label}</th>
                <td>
                  {formatTick(bar.value)}
                  {bar.highlight ? " (highlighted)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
      figure={figure}
    >
      <YAxis plot={plot} scale={scale} ticks={shownTicks} />
      {figure.bars.map((bar, index) => {
        const center = plot.left + slot * (index + 0.5);
        const y = scale(bar.value);
        return (
          <g key={`${bar.label}-${index}`}>
            <rect
              className={
                bar.highlight
                  ? "fill-mint stroke-ink"
                  : "fill-azure-500 stroke-azure-500"
              }
              height={Math.max(plot.bottom - y, 0)}
              strokeWidth={bar.highlight ? 2 : 1}
              width={barWidth}
              x={center - barWidth / 2}
              y={y}
            />
            {showValues ? (
              <text
                className={cn(
                  MUTED_TEXT,
                  bar.highlight && "fill-ink font-semibold",
                )}
                textAnchor="middle"
                x={center}
                y={y - 5}
              >
                {formatTick(bar.value)}
              </text>
            ) : null}
            {index % labelEvery === 0 ? (
              <text
                className={cn(TEXT, "tabular-nums")}
                textAnchor="middle"
                x={center}
                y={plot.bottom + FONT + 4}
              >
                {bar.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <line
        className="stroke-ink"
        strokeWidth={1.5}
        x1={plot.left}
        x2={plot.right}
        y1={plot.bottom}
        y2={plot.bottom}
      />
      <AxisTitles plot={plot} xLabel={figure.xLabel} yLabel={figure.yLabel} />
    </FigureShell>
  );
}

const SERIES_STYLES = [
  { stroke: "stroke-azure-500", fill: "fill-azure-500", dash: undefined },
  { stroke: "stroke-ink", fill: "fill-ink", dash: "6 4" },
  { stroke: "stroke-green-700", fill: "fill-green-700", dash: "2 3" },
  { stroke: "stroke-ink-muted", fill: "fill-ink-muted", dash: "8 3 2 3" },
] as const;

function LineFigure({
  figure,
  className,
}: {
  figure: QuestionFigureLine;
  className?: string;
}) {
  const plot = plotBox(Boolean(figure.xLabel), Boolean(figure.yLabel));
  const points = figure.series.flatMap((series) => series.points);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(...ys), 4);
  const [xMin, xMax] = [xTicks[0], xTicks[xTicks.length - 1]];
  const [yMin, yMax] = [yTicks[0], yTicks[yTicks.length - 1]];
  const sx = (x: number) =>
    plot.left + ((x - xMin) / (xMax - xMin)) * (plot.right - plot.left);
  const sy = (y: number) =>
    plot.bottom - ((y - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
  const showLegend = figure.series.length > 1;
  const showDots = points.length <= 60;

  return (
    <FigureShell
      after={
        <>
          {showLegend ? (
            <ul className="type-caption flex flex-wrap gap-x-4 gap-y-1">
              {figure.series.map((series, index) => {
                const style = SERIES_STYLES[index % SERIES_STYLES.length];
                return (
                  <li className="flex items-center gap-2" key={index}>
                    <svg
                      aria-hidden="true"
                      height="10"
                      viewBox="0 0 28 10"
                      width="28"
                    >
                      <line
                        className={style.stroke}
                        strokeDasharray={style.dash}
                        strokeWidth={2.5}
                        x1={0}
                        x2={28}
                        y1={5}
                        y2={5}
                      />
                    </svg>
                    <span className="text-ink">{series.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <table className="sr-only">
            <caption>{figure.title ?? "Chart data"}</caption>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col">{figure.xLabel ?? "x"}</th>
                <th scope="col">{figure.yLabel ?? "y"}</th>
              </tr>
            </thead>
            <tbody>
              {figure.series.flatMap((series, seriesIndex) =>
                series.points.map(([x, y], pointIndex) => (
                  <tr key={`${seriesIndex}-${pointIndex}`}>
                    <th scope="row">{series.label}</th>
                    <td>{formatTick(x)}</td>
                    <td>{formatTick(y)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      }
      className={className}
      figure={figure}
    >
      <YAxis plot={plot} scale={sy} ticks={yTicks} />
      {xTicks.map((tick) => (
        <text
          className={MUTED_TEXT}
          key={tick}
          textAnchor="middle"
          x={sx(tick)}
          y={plot.bottom + FONT + 4}
        >
          {formatTick(tick)}
        </text>
      ))}
      <line
        className="stroke-ink"
        strokeWidth={1.5}
        x1={plot.left}
        x2={plot.right}
        y1={plot.bottom}
        y2={plot.bottom}
      />
      {figure.series.map((series, index) => {
        const style = SERIES_STYLES[index % SERIES_STYLES.length];
        const sorted = [...series.points].sort((a, b) => a[0] - b[0]);
        return (
          <g key={index}>
            <polyline
              className={cn(style.stroke, "fill-none")}
              points={sorted.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")}
              strokeDasharray={style.dash}
              strokeLinejoin="round"
              strokeWidth={2.5}
            />
            {showDots
              ? sorted.map(([x, y], pointIndex) => (
                  <circle
                    className={style.fill}
                    cx={sx(x)}
                    cy={sy(y)}
                    key={pointIndex}
                    r={3}
                  />
                ))
              : null}
          </g>
        );
      })}
      <AxisTitles plot={plot} xLabel={figure.xLabel} yLabel={figure.yLabel} />
    </FigureShell>
  );
}

function normalPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

function NormalFigure({
  figure,
  className,
}: {
  figure: QuestionFigureNormal;
  className?: string;
}) {
  const { mean, sd } = figure;
  const plot = {
    left: 12,
    right: WIDTH - 12,
    top: 16,
    bottom: HEIGHT - (figure.xLabel ? 46 : 26),
  };
  const lo = mean - 3.5 * sd;
  const hi = mean + 3.5 * sd;
  const peak = normalPdf(mean, mean, sd);
  const sx = (x: number) =>
    plot.left + ((x - lo) / (hi - lo)) * (plot.right - plot.left);
  const sy = (density: number) =>
    plot.bottom - (density / peak) * (plot.bottom - plot.top);
  const samples = 140;
  const curvePoints = (from: number, to: number) => {
    const out: string[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const x = from + ((to - from) * i) / samples;
      out.push(`${sx(x).toFixed(2)},${sy(normalPdf(x, mean, sd)).toFixed(2)}`);
    }
    return out;
  };
  const curve = curvePoints(lo, hi);

  const shadeFrom = Math.max(figure.shade?.from ?? lo, lo);
  const shadeTo = Math.min(figure.shade?.to ?? hi, hi);
  const hasShade = figure.shade !== undefined && shadeFrom < shadeTo;
  const shadePath = hasShade
    ? `M${sx(shadeFrom).toFixed(2)},${plot.bottom} L${curvePoints(shadeFrom, shadeTo).join(" L")} L${sx(shadeTo).toFixed(2)},${plot.bottom} Z`
    : undefined;
  const edges = [figure.shade?.from, figure.shade?.to].filter(
    (edge): edge is number => edge !== undefined && edge > lo && edge < hi,
  );

  const sigmaLabel = (k: number) =>
    k === 0
      ? "μ"
      : `μ${k > 0 ? "+" : "−"}${Math.abs(k) === 1 ? "" : Math.abs(k)}σ`;

  return (
    <FigureShell className={className} figure={figure}>
      {shadePath ? (
        <path className="fill-azure-100 stroke-none" d={shadePath} />
      ) : null}
      {edges.map((edge) => (
        <line
          className="stroke-azure-500"
          key={edge}
          strokeWidth={2}
          x1={sx(edge)}
          x2={sx(edge)}
          y1={plot.bottom}
          y2={sy(normalPdf(edge, mean, sd))}
        />
      ))}
      <polyline
        className="fill-none stroke-ink"
        points={curve.join(" ")}
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <line
        className="stroke-ink"
        strokeWidth={1.5}
        x1={plot.left}
        x2={plot.right}
        y1={plot.bottom}
        y2={plot.bottom}
      />
      {[-3, -2, -1, 0, 1, 2, 3].map((k) => {
        const x = mean + k * sd;
        return (
          <g key={k}>
            <line
              className="stroke-ink"
              strokeWidth={1}
              x1={sx(x)}
              x2={sx(x)}
              y1={plot.bottom}
              y2={plot.bottom + 5}
            />
            <text
              className={MUTED_TEXT}
              textAnchor="middle"
              x={sx(x)}
              y={plot.bottom + FONT + 6}
            >
              {figure.xLabel ? formatTick(x) : sigmaLabel(k)}
            </text>
          </g>
        );
      })}
      {figure.xLabel ? (
        <text
          className={TEXT}
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={HEIGHT - 4}
        >
          {figure.xLabel}
        </text>
      ) : null}
    </FigureShell>
  );
}

function VennFigure({
  figure,
  className,
}: {
  figure: QuestionFigureVenn;
  className?: string;
}) {
  const [left, right] = figure.sets;
  const regions = figure.regions ?? {};
  const cy = 134;
  const r = 74;
  const leftX = 136;
  const rightX = 224;
  return (
    <FigureShell className={className} figure={figure}>
      <rect
        className="fill-none stroke-rule"
        height={HEIGHT - 8}
        rx={6}
        strokeWidth={1.5}
        width={WIDTH - 8}
        x={4}
        y={4}
      />
      <circle
        className="fill-azure-100 stroke-azure-500"
        cx={leftX}
        cy={cy}
        fillOpacity={0.7}
        r={r}
        strokeWidth={2}
      />
      <circle
        className="fill-azure-100 stroke-ink"
        cx={rightX}
        cy={cy}
        fillOpacity={0.7}
        r={r}
        strokeDasharray="6 4"
        strokeWidth={2}
      />
      <text
        className={cn(TEXT, "font-semibold")}
        textAnchor="middle"
        x={leftX - 24}
        y={cy - r - 10}
      >
        {left.label}
      </text>
      <text
        className={cn(TEXT, "font-semibold")}
        textAnchor="middle"
        x={rightX + 24}
        y={cy - r - 10}
      >
        {right.label}
      </text>
      {regions.left ? (
        <text
          className={cn(TEXT, "tabular-nums")}
          dominantBaseline="middle"
          textAnchor="middle"
          x={leftX - 34}
          y={cy}
        >
          {regions.left}
        </text>
      ) : null}
      {regions.both ? (
        <text
          className={cn(TEXT, "tabular-nums")}
          dominantBaseline="middle"
          textAnchor="middle"
          x={(leftX + rightX) / 2}
          y={cy}
        >
          {regions.both}
        </text>
      ) : null}
      {regions.right ? (
        <text
          className={cn(TEXT, "tabular-nums")}
          dominantBaseline="middle"
          textAnchor="middle"
          x={rightX + 34}
          y={cy}
        >
          {regions.right}
        </text>
      ) : null}
      {regions.neither ? (
        <text
          className={cn(TEXT, "tabular-nums")}
          textAnchor="end"
          x={WIDTH - 14}
          y={HEIGHT - 14}
        >
          {regions.neither}
        </text>
      ) : null}
    </FigureShell>
  );
}

export function QuestionFigureView({
  figure,
  className,
}: {
  figure: QuestionFigure;
  className?: string;
}): React.JSX.Element {
  switch (figure.kind) {
    case "bar":
      return <BarFigure className={className} figure={figure} />;
    case "line":
      return <LineFigure className={className} figure={figure} />;
    case "normal":
      return <NormalFigure className={className} figure={figure} />;
    case "venn":
      return <VennFigure className={className} figure={figure} />;
  }
}
