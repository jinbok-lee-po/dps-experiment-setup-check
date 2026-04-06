#!/usr/bin/env node
/**
 * DPS(Dynamic Pricing Service) 어드민: 실험 edit 화면의 Select Target Customers → Zones 목록 출력
 *
 * 새 채팅에서 쓰려면:
 * 1) Chrome에서 chrome://inspect/#remote-debugging 원격 디버깅 켜기
 * 2) Node.js 22+
 * 3) chrome-cdp 스킬 경로: ~/.cursor/skills-cursor/chrome-cdp 이거나
 *    이 프로젝트의 chrome-cdp-skill 클론, 또는 CHROME_CDP_SKILL 환경변수
 *
 * 사용:
 *   node scripts/dps-experiment-zones.mjs [실험ID] [--target 타겟ID접두사]
 *   node scripts/dps-experiment-zones.mjs --batch 149-152,154-158 [--target ...]
 *
 * 예:
 *   node scripts/dps-experiment-zones.mjs 158
 *   node scripts/dps-experiment-zones.mjs 158 --target AFDD0C34
 *   node scripts/dps-experiment-zones.mjs --batch 149-152,154-158
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

function resolveCdpRoot() {
  const env = process.env.CHROME_CDP_SKILL?.trim();
  if (env && existsSync(join(env, "scripts/cdp.mjs"))) return env;
  const local = join(PROJECT_ROOT, "chrome-cdp-skill/skills/chrome-cdp");
  if (existsSync(join(local, "scripts/cdp.mjs"))) return local;
  const cursor = join(homedir(), ".cursor/skills-cursor/chrome-cdp");
  if (existsSync(join(cursor, "scripts/cdp.mjs"))) return cursor;
  return null;
}

function runCdp(cdpRoot, args) {
  const cdp = join(cdpRoot, "scripts/cdp.mjs");
  const r = spawnSync(process.execPath, [cdp, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").trim() || `exit ${r.status}`;
    throw new Error(msg);
  }
  return r.stdout;
}

/** "149-152,154,156-158" → 정렬·중복 제거된 ID 배열 */
function parseBatchSpec(spec) {
  const ids = [];
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw.includes("-")) {
      const [a, b] = raw.split("-").map((x) => x.trim());
      const start = Number(a);
      const end = Number(b);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        throw new Error(`잘못된 구간: ${raw}`);
      }
      for (let n = start; n <= end; n++) ids.push(n);
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error(`잘못된 실험 ID: ${raw}`);
      ids.push(n);
    }
  }
  return [...new Set(ids)].sort((x, y) => x - y);
}

function parseArgs(argv) {
  let experimentId = "158";
  let targetPrefix = null;
  let batchSpec = null;
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--target") {
      targetPrefix = rest[++i];
      if (!targetPrefix) throw new Error("--target 뒤에 타겟 ID 접두사가 필요합니다.");
      continue;
    }
    if (rest[i] === "--batch") {
      batchSpec = rest[++i];
      if (!batchSpec) throw new Error("--batch 뒤에 구간/목록이 필요합니다. 예: 149-152,154-158");
      continue;
    }
    if (rest[i].startsWith("-")) throw new Error(`알 수 없는 옵션: ${rest[i]}`);
    experimentId = rest[i];
  }
  if (batchSpec) {
    const batchIds = parseBatchSpec(batchSpec);
    if (batchIds.length === 0) throw new Error("--batch 결과가 비었습니다.");
    return { mode: "batch", batchIds, targetPrefix };
  }
  if (!/^\d+$/.test(experimentId)) {
    throw new Error(`실험 ID는 숫자여야 합니다: ${experimentId}`);
  }
  return { mode: "single", experimentId, targetPrefix };
}

function findPortalTargetPrefix(listStdout) {
  const lines = listStdout.split("\n").filter(Boolean);
  for (const line of lines) {
    if (line.includes("logistics-dynamic-pricing")) {
      const prefix = line.trim().split(/\s+/)[0];
      if (prefix && /^[0-9A-F]+$/i.test(prefix)) return prefix;
    }
  }
  return null;
}

/** iframe 이 목표 실험 edit URL 일 때만 파싱 (이전 실험 Zones 를 읽지 않도록) */
function extractZonesJsForExperiment(expectedId) {
  const exp = JSON.stringify(String(expectedId));
  return `(() => {
    const expected = ${exp};
    const f = document.querySelector("iframe.pluginIframe");
    if (!f) return JSON.stringify({ ok: false, error: "no iframe.pluginIframe" });
    let href = "";
    try {
      href = (f.contentWindow && f.contentWindow.location && f.contentWindow.location.href) || "";
    } catch (e) {
      return JSON.stringify({ ok: false, error: "cannot read iframe location: " + e });
    }
    const m = href.match(/\\/incentives\\/(\\d+)\\/edit(?:[?#]|$)/);
    const current = m ? m[1] : null;
    if (current !== expected) {
      return JSON.stringify({
        ok: false,
        error: "iframe route mismatch (current " + current + ", need " + expected + ")",
      });
    }
    let d;
    try {
      d = f.contentDocument;
    } catch (e) {
      return JSON.stringify({ ok: false, error: "cannot access iframe: " + e });
    }
    if (!d || !d.body) return JSON.stringify({ ok: false, error: "no iframe body" });
    const t = d.body.innerText || "";
    const marker = "Select Target Customers";
    const zonesLabel = "\\nZones\\n";
    let from = t.indexOf(marker);
    if (from === -1) from = 0;
    const slice = t.slice(from);
    const z = slice.indexOf(zonesLabel);
    if (z === -1) return JSON.stringify({ ok: false, error: "Zones section not found in iframe text" });
    const after = slice.slice(z + zonesLabel.length);
    const end = after.search(/\\nParent Verticals\\b/);
    const block = end === -1 ? after : after.slice(0, end);
    const lines = block
      .split("\\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== "Zones");
    return JSON.stringify({ ok: true, zones: lines });
  })()`;
}

/**
 * 상위 창만 nav 하면 plugin iframe 의 해시가 안 바뀌어 목록 화면에 머무는 경우가 있다.
 * iframe.contentWindow.location 을 실험 edit URL 로 맞춘다.
 */
function navPluginIframeToEditJs(experimentId) {
  const hash = `#/experiments/incentives/${experimentId}/edit`;
  return `(() => {
    const base = "https://portal.woowahan.com/pv2/kr/p/logistics-dynamic-pricing";
    const hash = ${JSON.stringify(hash)};
    const f = document.querySelector("iframe.pluginIframe");
    if (!f || !f.contentWindow) return JSON.stringify({ ok: false, error: "no iframe.pluginIframe" });
    try {
      f.contentWindow.location.replace(base + hash);
      return JSON.stringify({ ok: true });
    } catch (e) {
      return JSON.stringify({ ok: false, error: "iframe nav: " + e });
    }
  })()`;
}

function parseIframeNavResult(evalOut) {
  const line = evalOut.trim().split("\n").pop() || evalOut.trim();
  const data = JSON.parse(line);
  if (!data.ok) throw new Error(data.error || "iframe navigation failed");
}

function parseEvalZonesJson(evalOut) {
  const line = evalOut.trim().split("\n").pop() || evalOut.trim();
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    throw new Error(`eval 결과 JSON 파싱 실패:\n${evalOut}`);
  }
  if (!data.ok) throw new Error(data.error || "unknown error");
  return data.zones;
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

/**
 * iframe 라우트가 목표 실험과 일치한 뒤에만 Zones 를 채택한다 (로딩 지연·스테일 UI 방지).
 * DPS_ZONES_POLL_MS (기본 600), DPS_ZONES_MAX_MS (기본 45000), DPS_ZONES_NAV_SETTLE_MS (기본 400)
 */
function fetchZonesForExperiment(cdpRoot, targetPrefix, experimentId) {
  const id = String(experimentId);
  const url = `https://portal.woowahan.com/pv2/kr/p/logistics-dynamic-pricing#/experiments/incentives/${id}/edit`;
  runCdp(cdpRoot, ["nav", targetPrefix, url]);
  parseIframeNavResult(runCdp(cdpRoot, ["eval", targetPrefix, navPluginIframeToEditJs(id)]));
  const settleMs = Number(process.env.DPS_ZONES_NAV_SETTLE_MS) || 400;
  const pollMs = Number(process.env.DPS_ZONES_POLL_MS) || 600;
  const maxMs = Number(process.env.DPS_ZONES_MAX_MS) || 45000;
  sleepSync(settleMs);
  const deadline = Date.now() + maxMs;
  let lastErr = "timeout waiting for target experiment + Zones section";
  while (Date.now() < deadline) {
    try {
      const evalOut = runCdp(cdpRoot, ["eval", targetPrefix, extractZonesJsForExperiment(id)]);
      return parseEvalZonesJson(evalOut);
    } catch (e) {
      lastErr = e.message || String(e);
      sleepSync(pollMs);
    }
  }
  throw new Error(lastErr);
}

function resolveTargetPrefix(cdpRoot, targetPrefix) {
  if (targetPrefix) return targetPrefix;
  let listOut;
  try {
    listOut = runCdp(cdpRoot, ["list"]);
  } catch (e) {
    console.error("cdp list 실패:", e.message);
    process.exit(1);
  }
  const found = findPortalTargetPrefix(listOut);
  if (!found) {
    console.error(
      "logistics-dynamic-pricing 탭을 list에서 찾지 못했습니다. 포털 탭을 연 뒤 다시 시도하거나 --target 으로 타겟 접두사를 지정하세요.\n\n--- list ---\n" +
        listOut
    );
    process.exit(1);
  }
  console.error(`(자동 선택 타겟 접두사: ${found})`);
  return found;
}

/** 실험 간 동일 zone 이름(문자열 일치) → 등장 실험 ID 목록 */
function findDuplicateZones(results) {
  /** @type {Map<string, number[]>} */
  const byName = new Map();
  for (const { experimentId, zones, error } of results) {
    if (error) continue;
    for (const name of zones) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(experimentId);
    }
  }
  const dupes = [];
  for (const [name, expIds] of byName) {
    const unique = [...new Set(expIds)].sort((a, b) => a - b);
    if (unique.length > 1) dupes.push({ zone: name, experimentIds: unique });
  }
  dupes.sort((a, b) => a.zone.localeCompare(b.zone));
  return dupes;
}

function printBatchReport(results) {
  const ok = results.filter((r) => !r.error);
  const fail = results.filter((r) => r.error);

  console.log("=== 실험별 zone 개수 ===");
  let sumCounts = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`${r.experimentId}\t(실패: ${r.error})`);
    } else {
      const n = r.zones.length;
      sumCounts += n;
      const uniq = new Set(r.zones).size;
      const intraDup = n > uniq ? `\t(동일 실험 내 중복 이름 ${n - uniq}건)` : "";
      console.log(`${r.experimentId}\t${n}${intraDup}`);
    }
  }
  console.log(`---`);
  console.log(`실험 수(시도): ${results.length}`);
  console.log(`성공 실험 수: ${ok.length}`);
  console.log(`실패 실험 수: ${fail.length}`);
  console.log(`zone 개수 합계(성공한 실험만, 행 단위 합): ${sumCounts}`);

  const allNames = new Set();
  for (const r of ok) for (const z of r.zones) allNames.add(z);
  console.log(`고유 zone 이름 수(전체 실험 통합): ${allNames.size}`);

  const dupes = findDuplicateZones(results);
  console.log("");
  console.log("=== 중복 zone (2개 이상 실험에 동일 이름) ===");
  if (dupes.length === 0) {
    console.log("(없음)");
  } else {
    for (const { zone, experimentIds } of dupes) {
      console.log(`${zone}\t→ 실험 [${experimentIds.join(", ")}]`);
    }
    console.log(`--- 중복으로 잡힌 서로 다른 zone 이름 수: ${dupes.length}`);
  }

  console.log("");
  console.log(JSON.stringify({ results, summary: { sumCounts, uniqueZoneNames: allNames.size, duplicateZoneEntries: dupes } }, null, 2));
}

function main() {
  const cdpRoot = resolveCdpRoot();
  if (!cdpRoot) {
    console.error(
      "chrome-cdp 스킬을 찾을 수 없습니다. CHROME_CDP_SKILL 설정, 프로젝트에 chrome-cdp-skill 클론, 또는 ~/.cursor/skills-cursor/chrome-cdp 를 준비하세요."
    );
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }

  const targetPrefix = resolveTargetPrefix(cdpRoot, parsed.targetPrefix);

  if (parsed.mode === "single") {
    const { experimentId } = parsed;
    try {
      const zones = fetchZonesForExperiment(cdpRoot, targetPrefix, experimentId);
      console.log(JSON.stringify({ experimentId, zones }, null, 2));
    } catch (e) {
      console.error(e.message || e);
      process.exit(1);
    }
    return;
  }

  /** @type {{ experimentId: number, zones?: string[], error?: string }[]} */
  const batchResults = [];
  for (const experimentId of parsed.batchIds) {
    try {
      const zones = fetchZonesForExperiment(cdpRoot, targetPrefix, String(experimentId));
      batchResults.push({ experimentId, zones });
    } catch (e) {
      const msg = String(e.message || e);
      console.error(`[실험 ${experimentId}] ${msg}`);
      batchResults.push({ experimentId, error: msg });
    }
  }
  printBatchReport(batchResults);
}

main();
