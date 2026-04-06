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
 *
 * 예:
 *   node scripts/dps-experiment-zones.mjs 158
 *   node scripts/dps-experiment-zones.mjs 158 --target AFDD0C34
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

function parseArgs(argv) {
  let experimentId = "158";
  let targetPrefix = null;
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--target") {
      targetPrefix = rest[++i];
      if (!targetPrefix) throw new Error("--target 뒤에 타겟 ID 접두사가 필요합니다.");
      continue;
    }
    if (rest[i].startsWith("-")) throw new Error(`알 수 없는 옵션: ${rest[i]}`);
    experimentId = rest[i];
  }
  if (!/^\d+$/.test(experimentId)) {
    throw new Error(`실험 ID는 숫자여야 합니다: ${experimentId}`);
  }
  return { experimentId, targetPrefix };
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

/** iframe.pluginIframe 안 innerText에서 Zones 블록만 파싱 (이름만) */
const EXTRACT_ZONES_JS = `(() => {
  const f = document.querySelector("iframe.pluginIframe");
  if (!f) return JSON.stringify({ ok: false, error: "no iframe.pluginIframe" });
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

function main() {
  const cdpRoot = resolveCdpRoot();
  if (!cdpRoot) {
    console.error(
      "chrome-cdp 스킬을 찾을 수 없습니다. CHROME_CDP_SKILL 설정, 프로젝트에 chrome-cdp-skill 클론, 또는 ~/.cursor/skills-cursor/chrome-cdp 를 준비하세요."
    );
    process.exit(1);
  }

  let experimentId;
  let targetPrefix;
  try {
    ({ experimentId, targetPrefix } = parseArgs(process.argv));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }

  if (!targetPrefix) {
    let listOut;
    try {
      listOut = runCdp(cdpRoot, ["list"]);
    } catch (e) {
      console.error("cdp list 실패:", e.message);
      process.exit(1);
    }
    targetPrefix = findPortalTargetPrefix(listOut);
    if (!targetPrefix) {
      console.error(
        "logistics-dynamic-pricing 탭을 list에서 찾지 못했습니다. 포털 탭을 연 뒤 다시 시도하거나 --target 으로 타겟 접두사를 지정하세요.\n\n--- list ---\n" +
          listOut
      );
      process.exit(1);
    }
    console.error(`(자동 선택 타겟 접두사: ${targetPrefix})`);
  }

  const url = `https://portal.woowahan.com/pv2/kr/p/logistics-dynamic-pricing#/experiments/incentives/${experimentId}/edit`;

  try {
    runCdp(cdpRoot, ["nav", targetPrefix, url]);
  } catch (e) {
    console.error("cdp nav 실패:", e.message);
    process.exit(1);
  }

  let evalOut;
  try {
    evalOut = runCdp(cdpRoot, ["eval", targetPrefix, EXTRACT_ZONES_JS]);
  } catch (e) {
    console.error("cdp eval 실패:", e.message);
    process.exit(1);
  }

  const line = evalOut.trim().split("\n").pop() || evalOut.trim();
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    console.error("eval 결과 JSON 파싱 실패:\n", evalOut);
    process.exit(1);
  }

  if (!data.ok) {
    console.error(data.error || "unknown error");
    process.exit(1);
  }

  console.log(JSON.stringify({ experimentId, zones: data.zones }, null, 2));
}

main();
