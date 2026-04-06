(() => {
  const VERSION = "1.0.1";
  const POLL_MS = 500;
  const MAX_MS = 25000;
  const BASE_PATH = "/pv2/kr/p/logistics-dynamic-pricing";
  const ORIGIN = "https://portal.woowahan.com";

  function isExperimentsPage() {
    if (window.location.hostname !== "portal.woowahan.com") return false;
    const path = (window.location.pathname || "").replace(/\/$/, "") || "/";
    const baseNorm = BASE_PATH.replace(/\/$/, "") || "/";
    const onDps = path === baseNorm || path.endsWith("/logistics-dynamic-pricing");
    if (!onDps) return false;
    const hash = window.location.hash || "";
    return hash.startsWith("#/experiments");
  }

  function parseIdInput(str) {
    const ids = [];
    for (const raw of str.split(",").map((s) => s.trim()).filter(Boolean)) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`잘못된 실험 ID: "${raw}" (양의 정수만, 쉼표로 구분)`);
      }
      ids.push(n);
    }
    if (ids.length === 0) throw new Error("실험 ID를 하나 이상 입력하세요.");
    return [...new Set(ids)].sort((a, b) => a - b);
  }

  function extractZonesFromIframe() {
    const f = document.querySelector("iframe.pluginIframe");
    if (!f) return { ok: false, error: "no iframe.pluginIframe" };
    let d;
    try {
      d = f.contentDocument;
    } catch (e) {
      return { ok: false, error: `cannot access iframe: ${e}` };
    }
    if (!d || !d.body) return { ok: false, error: "no iframe body" };
    const t = d.body.innerText || "";
    const marker = "Select Target Customers";
    const zonesLabel = "\nZones\n";
    let from = t.indexOf(marker);
    if (from === -1) from = 0;
    const slice = t.slice(from);
    const z = slice.indexOf(zonesLabel);
    if (z === -1) return { ok: false, error: "Zones section not found in iframe text" };
    const after = slice.slice(z + zonesLabel.length);
    const end = after.search(/\nParent Verticals\b/);
    const block = end === -1 ? after : after.slice(0, end);
    const lines = block
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== "Zones");
    return { ok: true, zones: lines };
  }

  function navIframeToEdit(experimentId) {
    const id = String(experimentId);
    const hash = `#/experiments/incentives/${id}/edit`;
    const f = document.querySelector("iframe.pluginIframe");
    if (!f || !f.contentWindow) return { ok: false, error: "no iframe.pluginIframe" };
    try {
      f.contentWindow.location.replace(`${ORIGIN}${BASE_PATH}${hash}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `iframe nav: ${e}` };
    }
  }

  function syncTopLocationToEdit(experimentId) {
    const id = String(experimentId);
    const hash = `#/experiments/incentives/${id}/edit`;
    const path = window.location.pathname.split("?")[0];
    const next = `${window.location.origin}${path}${hash}`;
    try {
      history.replaceState(null, "", next);
    } catch {
      window.location.hash = hash;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fetchZonesForExperiment(experimentId) {
    const id = String(experimentId);
    syncTopLocationToEdit(id);
    const navR = navIframeToEdit(id);
    if (!navR.ok) throw new Error(navR.error);

    const deadline = Date.now() + MAX_MS;
    let lastErr = "timeout waiting for Zones section";
    while (Date.now() < deadline) {
      const data = extractZonesFromIframe();
      if (data.ok) return data.zones;
      lastErr = data.error || lastErr;
      await sleep(POLL_MS);
    }
    throw new Error(lastErr);
  }

  function findDuplicateZones(results) {
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

  function buildReportText(results) {
    const ok = results.filter((r) => !r.error);
    const fail = results.filter((r) => r.error);
    const lines = [];
    lines.push("=== 실험별 zone 개수 ===");
    let sumCounts = 0;
    for (const r of results) {
      if (r.error) {
        lines.push(`${r.experimentId}\t(실패: ${r.error})`);
      } else {
        const n = r.zones.length;
        sumCounts += n;
        const uniq = new Set(r.zones).size;
        const intra = n > uniq ? `\t(동일 실험 내 중복 이름 ${n - uniq}건)` : "";
        lines.push(`${r.experimentId}\t${n}${intra}`);
      }
    }
    lines.push("---");
    lines.push(`실험 수(시도): ${results.length}`);
    lines.push(`성공 실험 수: ${ok.length}`);
    lines.push(`실패 실험 수: ${fail.length}`);
    lines.push(`zone 개수 합계(성공한 실험만, 행 단위 합): ${sumCounts}`);
    const allNames = new Set();
    for (const r of ok) for (const z of r.zones) allNames.add(z);
    lines.push(`고유 zone 이름 수(전체 실험 통합): ${allNames.size}`);
    lines.push("");
    lines.push("=== 중복 zone (2개 이상 실험에 동일 이름) ===");
    const dupes = findDuplicateZones(results);
    if (dupes.length === 0) {
      lines.push("(없음)");
    } else {
      for (const { zone, experimentIds } of dupes) {
        lines.push(`${zone}\t→ 실험 [${experimentIds.join(", ")}]`);
      }
      lines.push(`--- 중복으로 잡힌 서로 다른 zone 이름 수: ${dupes.length}`);
    }
    lines.push("");
    lines.push(
      JSON.stringify(
        { results, summary: { sumCounts, uniqueZoneNames: allNames.size, duplicateZoneEntries: dupes } },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  async function runBatch(ids) {
    /** @type {{ experimentId: number, zones?: string[], error?: string }[]} */
    const batchResults = [];
    for (const experimentId of ids) {
      try {
        const zones = await fetchZonesForExperiment(experimentId);
        batchResults.push({ experimentId, zones });
      } catch (e) {
        batchResults.push({ experimentId, error: String(e.message || e) });
      }
    }
    return batchResults;
  }

  function ensureRoot() {
    if (document.getElementById("dps-validator-root")) return;

    const root = document.createElement("div");
    root.id = "dps-validator-root";

    const fab = document.createElement("button");
    fab.id = "dps-validator-fab";
    fab.type = "button";
    fab.textContent = "DPS 설정 검증";
    fab.title = `DPS 설정 검증 v${VERSION}`;

    const overlay = document.createElement("div");
    overlay.id = "dps-validator-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "DPS 설정 검증");

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePanel();
    });

    const panel = document.createElement("div");
    panel.id = "dps-validator-panel";
    panel.addEventListener("click", (e) => e.stopPropagation());

    panel.innerHTML = `
      <header>
        <h1>DPS 설정 검증 <span style="font-weight:500;color:#6c757d;font-size:13px">v${VERSION}</span></h1>
        <button type="button" class="dps-close" aria-label="닫기">×</button>
      </header>
      <div class="dps-body">
        <label class="dps-label" for="dps-ids-input">실험 ID (쉼표로 구분)</label>
        <textarea id="dps-ids-input" placeholder="예: 141, 142, 143, 144, 155" spellcheck="false"></textarea>
        <div class="dps-meta">
          <strong>이 버전에서 검증 가능한 항목</strong>
          <ul>
            <li>실험별 <strong>zone 개수</strong></li>
            <li>각 실험에 설정된 <strong>zone 이름 목록</strong></li>
            <li>전체 실험에 대한 zone 개수 합계·고유 이름 수·<strong>실험 간 중복 zone</strong> 여부</li>
          </ul>
        </div>
        <div class="dps-actions">
          <button type="button" id="dps-run">실행</button>
        </div>
        <div id="dps-results"></div>
      </div>
    `;

    const closeBtn = panel.querySelector(".dps-close");
    const runBtn = panel.querySelector("#dps-run");
    const input = panel.querySelector("#dps-ids-input");
    const resultsEl = panel.querySelector("#dps-results");

    function openPanel() {
      if (!isExperimentsPage()) {
        alert(
          "DPS 실험 목록 화면에서만 사용할 수 있습니다.\n\n" +
            `${ORIGIN}${BASE_PATH}#/experiments\n로 이동한 뒤 다시 열어 주세요.`
        );
        return;
      }
      overlay.hidden = false;
      input.focus();
    }

    function closePanel() {
      overlay.hidden = true;
    }

    fab.addEventListener("click", openPanel);
    closeBtn.addEventListener("click", closePanel);

    runBtn.addEventListener("click", async () => {
      resultsEl.classList.remove("dps-visible");
      resultsEl.textContent = "";
      const oldErr = panel.querySelector(".dps-err");
      if (oldErr) oldErr.remove();

      let ids;
      try {
        ids = parseIdInput(input.value);
      } catch (e) {
        const p = document.createElement("p");
        p.className = "dps-err";
        p.textContent = String(e.message || e);
        panel.querySelector(".dps-actions").after(p);
        return;
      }

      runBtn.disabled = true;
      runBtn.textContent = "실행 중…";
      try {
        const batchResults = await runBatch(ids);
        const pre = document.createElement("pre");
        pre.textContent = buildReportText(batchResults);
        resultsEl.appendChild(pre);
        resultsEl.classList.add("dps-visible");
      } catch (e) {
        const p = document.createElement("p");
        p.className = "dps-err";
        p.textContent = String(e.message || e);
        panel.querySelector(".dps-actions").after(p);
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "실행";
      }
    });

    overlay.appendChild(panel);
    root.appendChild(fab);
    root.appendChild(overlay);
    document.documentElement.appendChild(root);

    function refreshFabVisibility() {
      fab.style.display = isExperimentsPage() ? "block" : "none";
      if (!isExperimentsPage() && !overlay.hidden) closePanel();
    }

    refreshFabVisibility();
    window.addEventListener("hashchange", refreshFabVisibility);
    window.addEventListener("popstate", refreshFabVisibility);
  }

  ensureRoot();
})();
