(() => {
  const VERSION = "1.1.1";
  const POLL_MS = 600;
  /** 실험당 iframe 로딩·라우트 반영 대기 상한 (ms) */
  const MAX_MS = 45000;
  const NAV_SETTLE_MS = 400;
  const BASE_PATH = "/pv2/kr/p/logistics-dynamic-pricing";
  const ORIGIN = "https://portal.woowahan.com";
  /** 실행창·FAB 노출: 목록 또는 그 하위(…/id/edit, …/clone 등) (쿼리 제외, 끝 슬래시 정규화) */
  const INCENTIVES_HASH_PREFIX = "#/experiments/incentives";
  /** Select Target Customers → Parent Verticals 기대값 (대소문자 무시) */
  const EXPECTED_PARENT_VERTICAL = "restaurant";

  function normalizedHash() {
    const raw = (window.location.hash || "").split("?")[0];
    return (raw.replace(/\/$/, "") || "").toLowerCase();
  }

  function isIncentivesExperimentsRoute() {
    if (window.location.hostname !== "portal.woowahan.com") return false;
    const path = (window.location.pathname || "").replace(/\/$/, "") || "/";
    const baseNorm = BASE_PATH.replace(/\/$/, "") || "/";
    const onDps =
      path === baseNorm ||
      path.endsWith("/logistics-dynamic-pricing") ||
      path.includes("/logistics-dynamic-pricing/");
    if (!onDps) return false;
    const h = normalizedHash();
    const p = INCENTIVES_HASH_PREFIX.toLowerCase();
    return h === p || h.startsWith(`${p}/`);
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

  /** Zones 가 비었을 때 본문에 흔한 오류·미존재 안내가 있는지 (보조 판별) */
  function findLikelyExperimentLoadError(bodyText) {
    const t = bodyText || "";
    const lower = t.toLowerCase();
    if (/\b404\b/.test(t) || lower.includes("not found") || lower.includes("could not find")) {
      return "화면에 오류·미존재 안내가 감지됨 (404/not found 등)";
    }
    if (/존재하지\s*않|찾을\s*수\s*없|페이지(를)?\s*찾을\s*수\s*없/.test(t)) {
      return "화면에 실험·페이지 미존재 안내가 감지됨";
    }
    return null;
  }

  /** Parent Verticals 라벨 직후 본문에서 값 줄만 수집 (빈 줄 전까지, 상한 30줄) */
  function parseParentVerticalValues(afterLabel) {
    const rows = (afterLabel || "").split("\n");
    const out = [];
    for (const row of rows) {
      const s = row.trim();
      if (s === "") {
        if (out.length > 0) break;
        continue;
      }
      if (/^(select target customers|zones)\b/i.test(s)) break;
      out.push(s);
      if (out.length >= 30) break;
    }
    return out;
  }

  function parentVerticalsIncludeExpected(vals, expectedLower) {
    return vals.some((v) => String(v).trim().toLowerCase() === expectedLower);
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
    const end = after.search(/\nParent Verticals\b/i);
    if (end === -1) return { ok: false, error: "Parent Verticals section not found in iframe text" };
    const block = after.slice(0, end);
    const lines = block
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== "Zones");
    if (lines.length === 0) {
      const hint = findLikelyExperimentLoadError(t);
      const base = "실험을 불러오지 못했거나 존재하지 않는 실험일 수 있습니다 (Zones 목록이 비어 있음)";
      return { ok: false, error: hint ? `${hint} / ${base}` : base };
    }
    const afterPv = after.slice(end).replace(/^\s*\n*Parent Verticals\b\s*/i, "");
    const parentVerticals = parseParentVerticalValues(afterPv);
    if (parentVerticals.length === 0) {
      return { ok: false, error: "Parent Verticals 값이 비어 있음" };
    }
    return { ok: true, zones: lines, parentVerticals };
  }

  /** iframe 이 실제로 해당 실험 edit URL 로 로드됐는지 — 이전 실험의 Zones 텍스트를 읽지 않도록 함 */
  function getIframeRouteExperimentId() {
    const f = document.querySelector("iframe.pluginIframe");
    if (!f?.contentWindow) return null;
    let href = "";
    try {
      href = f.contentWindow.location.href || "";
    } catch {
      return null;
    }
    const m = href.match(/\/incentives\/(\d+)\/edit(?:[?#]|$)/);
    return m ? m[1] : null;
  }

  function iframeShowsExperiment(experimentId) {
    return getIframeRouteExperimentId() === String(experimentId);
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

  let referenceZonesPromise = null;
  function loadReferenceZones() {
    if (!referenceZonesPromise) {
      referenceZonesPromise = fetch(chrome.runtime.getURL("reference-zones.json"))
        .then((r) => {
          if (!r.ok) throw new Error(`reference-zones.json HTTP ${r.status}`);
          return r.json();
        })
        .catch((e) => {
          referenceZonesPromise = null;
          throw e;
        });
    }
    return referenceZonesPromise;
  }

  function normalizeZoneLabel(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function computeRgn2Coverage(results, ref) {
    const collected = new Set();
    for (const r of results) {
      if (r.error || !r.zones) continue;
      for (const z of r.zones) collected.add(normalizeZoneLabel(z));
    }
    const refNameSet = new Set(ref.zones.map(({ name }) => normalizeZoneLabel(name)));
    const missing = ref.zones.filter(({ name }) => !collected.has(normalizeZoneLabel(name)));
    const matchedRefCount = ref.zones.length - missing.length;
    const orphans = [...collected].filter((c) => !refNameSet.has(c)).sort((a, b) => a.localeCompare(b));
    return {
      totalRef: ref.zones.length,
      updated: ref.updated,
      unionDistinctCount: collected.size,
      matchedRefCount,
      missing,
      missingCount: missing.length,
      orphans,
      orphanCount: orphans.length,
    };
  }

  async function fetchZonesForExperiment(experimentId) {
    const id = String(experimentId);
    syncTopLocationToEdit(id);
    const navR = navIframeToEdit(id);
    if (!navR.ok) throw new Error(navR.error);

    await sleep(NAV_SETTLE_MS);

    const deadline = Date.now() + MAX_MS;
    let lastErr = "timeout waiting for target experiment in iframe";
    while (Date.now() < deadline) {
      if (!iframeShowsExperiment(experimentId)) {
        const cur = getIframeRouteExperimentId();
        lastErr =
          cur == null
            ? "iframe route not on experiment edit yet"
            : `iframe still on experiment ${cur}, waiting for ${id}`;
        await sleep(POLL_MS);
        continue;
      }
      const data = extractZonesFromIframe();
      if (data.ok) return { zones: data.zones, parentVerticals: data.parentVerticals };
      lastErr = data.error || lastErr;
      await sleep(POLL_MS);
    }
    throw new Error(lastErr);
  }

  function findParentVerticalMismatches(results, expectedLower) {
    const mismatches = [];
    for (const r of results) {
      if (r.error) continue;
      const pv = r.parentVerticals || [];
      if (!parentVerticalsIncludeExpected(pv, expectedLower)) {
        mismatches.push({ experimentId: r.experimentId, parentVerticals: pv });
      }
    }
    return mismatches;
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

  function buildReportText(results, ref) {
    const ok = results.filter((r) => !r.error);
    const fail = results.filter((r) => r.error);
    let sumCounts = 0;
    for (const r of results) {
      if (!r.error) sumCounts += r.zones.length;
    }
    const allNames = new Set();
    for (const r of ok) for (const z of r.zones) allNames.add(z);
    const dupes = findDuplicateZones(results);
    const expectedPvLower = EXPECTED_PARENT_VERTICAL.toLowerCase();
    const pvMismatches = findParentVerticalMismatches(results, expectedPvLower);
    let coverage = null;
    if (ref && Array.isArray(ref.zones)) {
      coverage = computeRgn2Coverage(results, ref);
    }

    const lines = [];
    lines.push("=== 0. 개요 ===");
    lines.push(`시도 ${results.length}건 (성공 ${ok.length} · 실패 ${fail.length})`);
    lines.push(
      `실험에 셋팅된 시군구zone의 총 합계: ${sumCounts} · 중복 제거한 전체 실험대상 시군구zone의 합: ${allNames.size}`
    );
    lines.push("");
    lines.push("=== 1. 중복 zone (2개 이상 실험에 동일 이름) ===");
    lines.push(
      "DPS는 동일 지역(zone)에 대해 하나의 인센티브 실험만 둘 수 있습니다. 아래에 항목이 있으면 크롬 익스텐션을 재실행하시고, 크롬 익스텐션 오류를 제보해주세요."
    );
    if (dupes.length === 0) {
      lines.push("(없음)");
    } else {
      for (const { zone, experimentIds } of dupes) {
        lines.push(`${zone}\t→ 실험 [${experimentIds.join(", ")}]`);
      }
      lines.push(`--- 중복으로 잡힌 서로 다른 zone 이름 수: ${dupes.length}`);
    }

    lines.push("");
    lines.push("=== 2. Parent Verticals (restaurant) ===");
    lines.push(
      `Select Target Customers의 Parent Verticals에 "${EXPECTED_PARENT_VERTICAL}"(대소문자 무시)가 포함되어야 합니다. 아래 실험은 화면에서 읽은 값 기준으로 조건을 만족하지 않습니다.`
    );
    if (pvMismatches.length === 0) {
      lines.push("(없음 · 수집 성공한 실험 모두 조건 충족)");
    } else {
      for (const { experimentId, parentVerticals } of pvMismatches) {
        const shown = parentVerticals.length ? parentVerticals.join(", ") : "(비어 있음)";
        lines.push(`${experimentId}\t실제: ${shown}`);
      }
      lines.push(`--- 조건 불만족 실험 수: ${pvMismatches.length}`);
    }

    if (coverage) {
      lines.push("");
      lines.push("=== 3. 기준 지역(RGN2) 커버리지 ===");
      lines.push(`실험에서 수집된 실험 시군구zone 수: ${coverage.unionDistinctCount}`);
      lines.push(`OD 오픈지역 내 실험 시군구Zone 수: ${coverage.matchedRefCount}`);
      if (coverage.orphanCount > 0) {
        lines.push("기준 목록에 없는 수집 문자열:");
        for (const o of coverage.orphans) lines.push(o);
      }
      lines.push(`기준 일자: ${coverage.updated}`);
      lines.push(`전체 OD 오픈지역 수: ${coverage.totalRef}`);
      lines.push(`기준 대비 누락: ${coverage.missingCount}개`);
      if (coverage.missingCount > 0) {
        lines.push("누락 목록 (RGN2_CD\t시군구명):");
        for (const m of coverage.missing) lines.push(`${m.rgn2_cd}\t${m.name}`);
      } else {
        lines.push("(누락 없음)");
      }
    }

    lines.push("");
    lines.push("=== 4. 실험별 zone 개수 ===");
    for (const r of results) {
      if (r.error) {
        lines.push(`${r.experimentId}\t(실패: ${r.error})`);
      } else {
        const n = r.zones.length;
        const uniq = new Set(r.zones).size;
        const intra = n > uniq ? `\t(동일 실험 내 중복 이름 ${n - uniq}건)` : "";
        lines.push(`${r.experimentId}\t${n}${intra}`);
      }
    }

    lines.push("");
    lines.push(
      JSON.stringify(
        {
          results,
          summary: {
            sumCounts,
            uniqueZoneNames: allNames.size,
            duplicateZoneEntries: dupes,
            expectedParentVertical: EXPECTED_PARENT_VERTICAL,
            parentVerticalMismatches: pvMismatches,
            ...(coverage
              ? {
                  coverage: {
                    updated: coverage.updated,
                    totalRef: coverage.totalRef,
                    unionDistinctCount: coverage.unionDistinctCount,
                    matchedRefCount: coverage.matchedRefCount,
                    orphanCount: coverage.orphanCount,
                    orphans: coverage.orphans,
                    missingCount: coverage.missingCount,
                    missing: coverage.missing,
                  },
                }
              : {}),
          },
        },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  async function runBatch(ids) {
    /** @type {{ experimentId: number, zones?: string[], parentVerticals?: string[], error?: string }[]} */
    const batchResults = [];
    for (const experimentId of ids) {
      try {
        const { zones, parentVerticals } = await fetchZonesForExperiment(experimentId);
        batchResults.push({ experimentId, zones, parentVerticals });
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
    fab.textContent = "DPS 인센티브 실험 설정 검증";
    fab.title = `DPS 인센티브 실험 설정 검증 v${VERSION}`;

    const panelWrap = document.createElement("div");
    panelWrap.id = "dps-validator-panel-wrap";
    panelWrap.setAttribute("role", "dialog");
    panelWrap.setAttribute("aria-label", "DPS 인센티브 실험 설정 검증");

    const panel = document.createElement("div");
    panel.id = "dps-validator-panel";

    panel.innerHTML = `
      <header>
        <h1>DPS 인센티브 실험 설정 검증 <span style="font-weight:500;color:#6c757d;font-size:13px">v${VERSION}</span></h1>
        <button type="button" class="dps-close" aria-label="닫기">×</button>
      </header>
      <div class="dps-body">
        <label class="dps-label" for="dps-ids-input">실험 ID (쉼표로 구분)</label>
        <textarea id="dps-ids-input" placeholder="예: 141, 142, 143, 144, 155" spellcheck="false"></textarea>
        <div class="dps-meta">
          <p id="dps-ref-meta" class="dps-ref-line">기준 zone 목록 불러오는 중…</p>
          <strong>이 버전에서 검증 가능한 항목</strong>
          <ul>
            <li>실험별 <strong>zone 개수</strong></li>
            <li>각 실험에 설정된 <strong>zone 이름 목록</strong></li>
            <li>전체 실험에 대한 zone 개수 합계·고유 이름 수·<strong>실험 간 중복 zone</strong> 여부</li>
            <li>기준 RGN2 목록 대비 <strong>누락 지역(RGN2_CD·시군구명)</strong></li>
            <li>Select Target Customers의 <strong>Parent Verticals</strong>에 <strong>restaurant</strong> 포함 여부</li>
          </ul>
        </div>
        <div class="dps-actions">
          <button type="button" id="dps-run">실행</button>
        </div>
        <div id="dps-complete-banner" class="dps-complete">검증이 완료되었습니다.</div>
        <div id="dps-results"></div>
      </div>
    `;

    const closeBtn = panel.querySelector(".dps-close");
    const runBtn = panel.querySelector("#dps-run");
    const input = panel.querySelector("#dps-ids-input");
    const resultsEl = panel.querySelector("#dps-results");
    const completeBanner = panel.querySelector("#dps-complete-banner");

    function openPanel() {
      if (!isIncentivesExperimentsRoute()) {
        alert(
          "DPS 인센티브 실험 화면에서만 사용할 수 있습니다.\n\n" +
            `예: ${ORIGIN}${BASE_PATH}${INCENTIVES_HASH_PREFIX}\n` +
            `또는 ${ORIGIN}${BASE_PATH}#/experiments/incentives/… (edit·clone 등)`
        );
        return;
      }
      panelWrap.classList.add("dps-open");
      input.focus();
    }

    function closePanel() {
      panelWrap.classList.remove("dps-open");
    }

    fab.addEventListener("click", openPanel);
    closeBtn.addEventListener("click", closePanel);

    runBtn.addEventListener("click", async () => {
      resultsEl.classList.remove("dps-visible");
      resultsEl.textContent = "";
      completeBanner.classList.remove("dps-visible");
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
      let succeeded = false;
      try {
        const ref = await loadReferenceZones();
        const batchResults = await runBatch(ids);
        const pre = document.createElement("pre");
        pre.textContent = buildReportText(batchResults, ref);
        resultsEl.appendChild(pre);
        resultsEl.classList.add("dps-visible");
        succeeded = true;
      } catch (e) {
        const p = document.createElement("p");
        p.className = "dps-err";
        p.textContent = String(e.message || e);
        panel.querySelector(".dps-actions").after(p);
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "실행";
        if (succeeded) completeBanner.classList.add("dps-visible");
        syncFabVisibility();
      }
    });

    panelWrap.appendChild(panel);
    root.appendChild(fab);
    root.appendChild(panelWrap);
    document.documentElement.appendChild(root);

    /** 검증 중 replaceState 로 해시가 바뀌어도 hashchange 가 안 나므로, FAB 만 숨기고 패널은 유지 */
    function syncFabVisibility() {
      fab.style.display = isIncentivesExperimentsRoute() ? "block" : "none";
    }

    /** 사용자가 해시/히스토리로 목록 화면을 벗어나면 실행창 닫기 */
    function onUserNavigation() {
      syncFabVisibility();
      if (!isIncentivesExperimentsRoute() && panelWrap.classList.contains("dps-open")) closePanel();
    }

    syncFabVisibility();
    window.addEventListener("hashchange", onUserNavigation);
    window.addEventListener("popstate", onUserNavigation);

    loadReferenceZones()
      .then((ref) => {
        const el = document.getElementById("dps-ref-meta");
        if (el) el.textContent = `전체 기준 zone ${ref.zones.length}개 · 기준일 ${ref.updated}`;
      })
      .catch(() => {
        const el = document.getElementById("dps-ref-meta");
        if (el) el.textContent = "기준 zone 목록을 불러오지 못했습니다.";
      });

    /**
     * 포털 SPA는 해시만 바꿀 때 pushState/replaceState 를 쓰는 경우가 많아 hashchange 가 안 난다.
     * 그때도 FAB 가 뜨도록 히스토리 API 와 주기 폴링으로 동기화한다.
     */
    function hookHistoryForFabSync() {
      const notify = () => queueMicrotask(() => syncFabVisibility());
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function (...args) {
        const ret = origPush.apply(history, args);
        notify();
        return ret;
      };
      history.replaceState = function (...args) {
        const ret = origReplace.apply(history, args);
        notify();
        return ret;
      };
    }
    hookHistoryForFabSync();

    setInterval(syncFabVisibility, 400);
    setTimeout(syncFabVisibility, 50);
    setTimeout(syncFabVisibility, 500);
    setTimeout(syncFabVisibility, 2000);
  }

  ensureRoot();
})();
