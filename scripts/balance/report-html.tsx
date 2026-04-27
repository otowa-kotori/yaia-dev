import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { SimStats } from "./stats";

export interface HtmlReportOptions {
  title?: string;
  zoneNames?: Record<string, string>;
  rerunCommand?: string;
}

interface HtmlReportRow {
  profileKey: string;
  combatZoneId: string;
  combatZoneName: string;
  xpPerMinute: number;
  gpPerMinute: number;
  wavesPerMinute: number;
  winRate: number;
  dps: number;
  damageTakenPerTick: number;
  deathRate: number;
  finalLevel: number;
}

interface HtmlReportPayload {
  rows: HtmlReportRow[];
  rerunCommand: string;
}

const REPORT_CSS = readReportAsset("./report.css");
const REPORT_CLIENT_SCRIPT = readReportAsset("./report-client.js");

export function renderBalanceHtmlReport(
  results: SimStats[],
  options: HtmlReportOptions = {},
): string {
  const title = options.title ?? "Balance Report";
  const payload: HtmlReportPayload = {
    rows: buildHtmlRows(results, options.zoneNames ?? {}),
    rerunCommand: options.rerunCommand ?? "",
  };
  const document = renderToStaticMarkup(
    <BalanceReportDocument title={title} payload={payload} />,
  );
  return `<!doctype html>${document}`;
}

function buildHtmlRows(
  results: SimStats[],
  zoneNames: Record<string, string>,
): HtmlReportRow[] {
  return results.map((result) => ({
    profileKey: result.profileKey,
    combatZoneId: result.combatZoneId,
    combatZoneName: zoneNames[result.combatZoneId] ?? result.combatZoneId,
    xpPerMinute: result.xpPerMinute,
    gpPerMinute: result.currencyPerMinute["currency.gold"] ?? 0,
    wavesPerMinute: result.wavesPerMinute,
    winRate: result.winRate,
    dps: result.dps,
    damageTakenPerTick: result.damageTakenPerTick,
    deathRate: result.deathRate,
    finalLevel: result.finalLevel,
    minutesToNextLevel: result.minutesToNextLevel,
  }));
}


function readReportAsset(relativePath: string): string {
  const assetUrl = new URL(relativePath, import.meta.url);
  return readFileSync(fileURLToPath(assetUrl), "utf8");
}

function BalanceReportDocument(props: {
  title: string;
  payload: HtmlReportPayload;
}): JSX.Element {
  const payloadJson = JSON.stringify(props.payload).replace(/</g, "\\u003c");

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      </head>

      <body>
        <div className="page">
          <header className="hero">
            <h1>{props.title}</h1>
            <p>
              主视图改为 <strong>按战斗区顺序展开的折线图</strong>：优先看同一 profile
              跨图效率变化，同时保留同图不同 profile 的点位差。指标支持切换
              <strong> XP/分、GP/分、波次/分、胜率、DPS、受击DPS、死亡率/波 </strong>。
            </p>
          </header>

          <section className="panel">
            <h2>筛选与指标</h2>
            <div className="controls-grid">
              <div className="control-block">
                <div className="control-label">Metric</div>
                <div className="metric-toggle" id="metric-toggle" />
                <div className="hint">切换折线图、最佳刷图点和矩阵主指标。</div>
              </div>
              <div className="control-block">
                <div className="control-label">Profile ID 搜索</div>
                <input
                  id="profile-search"
                  className="search-input"
                  type="search"
                  placeholder="例如：knight_lv10 或 copper"
                />
                <div className="button-row">
                  <button type="button" id="select-visible">选中可见</button>
                  <button type="button" id="clear-visible">清空可见</button>
                  <button type="button" id="reset-profiles">重置全选</button>
                </div>
              </div>
              <div className="control-block">
                <div className="control-label">可见 Profile</div>
                <div id="profile-options" className="profile-list" />
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>复跑命令</h2>
            <div className="command-box">
              <pre id="rerun-command" className="command-pre" />
              <div className="button-row command-actions">
                <button type="button" id="copy-command">复制命令</button>
                <span id="copy-command-status" className="copy-status" />
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>当前视图摘要</h2>
            <div id="summary-grid" className="summary-grid" />
          </section>

          <section className="panel">
            <h2>效率折线图</h2>
            <div className="hint chart-hint">
              同色线代表同一 profile；横轴是战斗区顺序，纵轴是当前选择的指标。
            </div>
            <div id="legend" className="legend" />
            <div id="chart-root" />
          </section>

          <section className="panel">
            <h2>各 Profile 最佳刷图点</h2>
            <div id="best-grid" className="best-grid" />
          </section>

          <section className="panel">
            <h2>精确矩阵</h2>
            <div id="matrix-root" />
          </section>
        </div>

        <script
          id="report-data"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: payloadJson }}
        />
        <script dangerouslySetInnerHTML={{ __html: REPORT_CLIENT_SCRIPT }} />
      </body>
    </html>
  );
}
