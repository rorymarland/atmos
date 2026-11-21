// @ts-nocheck: plain DOM code carried over from the standalone check page; it only
// reports on data sources and shares nothing with the app, so it stays untyped.
/**
 * The data check page (/check): the shared forecasts' status from the alerts container,
 * and a check of every data source straight from this browser. Plain DOM code, started by
 * routes/check/+page.svelte; returns a function that stops it.
 */
export function startCheck(root) {
  const OM = 'https://api.open-meteo.com/v1/forecast';
  // Callander, the Trossachs zone's forecast point.
  const LAT = 56.244;
  const LON = -4.214;
  const MODELS = [
    'ukmo_uk_deterministic_2km',
    'ukmo_seamless',
    'ukmo_global_deterministic_10km',
    'ecmwf_ifs025',
    'icon_seamless',
  ];
  const SURFACE = [
    'temperature_2m',
    'relative_humidity_2m',
    'dew_point_2m',
    'wind_speed_10m',
    'wind_gusts_10m',
    'precipitation',
    'precipitation_probability',
    'cloud_cover',
    'cloud_cover_low',
    'cloud_cover_mid',
    'cloud_cover_high',
    'visibility',
    'pressure_msl',
    'freezing_level_height',
    'boundary_layer_height',
  ];
  const PRESSURE = [1000, 975, 950, 925, 900, 850, 800, 700];
  const PRESSURE_VARS = ['temperature', 'relative_humidity', 'wind_speed', 'geopotential_height'];
  const HEIGHTS = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000];

  // ---- Shared forecasts, from the alerts container ----
  const FEEDS = {
    met: 'Met Office (UKV and global)',
    ecmwf: 'ECMWF',
    harmonie: 'HARMONIE (KNMI)',
    horizon: 'Sunrise and sunset horizons',
    upper: 'Upper air (plane trails)',
  };
  const LOOKS = {
    fetched: 'Pulled a new run',
    'same-run': 'No new run yet',
    'over-budget': "Held back to save today's allowance",
    failed: 'Failed',
  };
  let shared = null;
  const sharedBox = root.querySelector('#shared');

  const esc = (t) =>
    String(t).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );

  function when(t, now) {
    if (t == null) return '–';
    const d = new Date(t);
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const sameDay = d.toDateString() === new Date(now).toDateString();
    return sameDay
      ? time
      : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })} ${time}`;
  }

  function ago(t, now) {
    const m = Math.round((now - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return `${h} h ${m % 60} min ago`;
  }

  function nextPull(f, now) {
    if (f.lastCheck === 'over-budget') return "Held back to stay under today's limit";
    const latest = `by ${when(f.latestBy, now)} at the latest`;
    if (now < f.notBefore)
      return `Not before ${when(f.notBefore, now)}, once a new run is out; ${latest}`;
    return `As soon as a new run is out; ${latest}`;
  }

  function renderShared(idx) {
    const now = idx.now;
    const parts = [];
    const recent = idx.limitedAt && now - idx.limitedAt < 24 * 3600e3;
    if (idx.pausedUntil) {
      const why = idx.events.find((e) => /refused/.test(e.text));
      parts.push(
        `<div class="banner bad">${why ? `${esc(why.text)}.` : `Open-Meteo refused a request. Paused until ${when(idx.pausedUntil, now)}.`}</div>`,
      );
    } else if (recent) {
      parts.push(
        `<div class="banner warn">Open-Meteo last refused a request at ${when(idx.limitedAt, now)}. Pulling normally since.</div>`,
      );
    } else {
      parts.push('<div class="banner ok">No Open-Meteo limits hit in the last 24 hours.</div>');
    }

    const pct = Math.min(100, (idx.spentToday / idx.dailyLimit) * 100);
    const level = pct > 85 ? 'bad' : pct > 65 ? 'warn' : '';
    parts.push(
      `<p style="margin:0"><strong>${idx.spentToday.toLocaleString('en-GB')}</strong> of about ${idx.dailyLimit.toLocaleString('en-GB')} Open-Meteo calls used in the last 24 hours (by the server; browsers falling back to Open-Meteo themselves aren't counted).</p>
       <div class="meter"><span class="${level}" style="width:${pct.toFixed(1)}%"></span></div>
       <p class="muted">Last look ${when(idx.lastCheckAt, now)}, next ${when(idx.nextCheckAt, now)}. It looks every 5 minutes, and pulls a feed only after its minimum gap once a new model run is out.</p>`,
    );

    const rowsHtml = Object.entries(FEEDS)
      .map(([id, name]) => {
        const f = idx.feeds[id];
        if (!f) return `<tr><td>${name}</td><td colspan="3" class="muted">Not pulled yet</td></tr>`;
        const look = f.lastCheck
          ? `${when(f.lastCheckAt, now)}: ${LOOKS[f.lastCheck]}${f.lastError ? `: ${esc(f.lastError)}` : ''}`
          : '–';
        const cls =
          f.lastCheck === 'failed' ? 'fail' : f.lastCheck === 'over-budget' ? 'partial' : '';
        return `<tr><td>${name}</td>
          <td class="nowrap">${when(f.fetchedAt, now)} <span class="muted">(${ago(f.fetchedAt, now)}), ${f.zones} ${id === 'horizon' ? 'points' : 'places'}</span></td>
          <td>${nextPull(f, now)}</td>
          <td class="${cls}">${look}</td></tr>`;
      })
      .join('');
    parts.push(
      `<table><thead><tr><th>Feed</th><th>Last pulled</th><th>Next pull</th><th>Last look</th></tr></thead><tbody>${rowsHtml}</tbody></table>`,
    );

    if (idx.events.length) {
      const ev = idx.events
        .slice(0, 20)
        .map(
          (e) =>
            `<tr><td class="nowrap">${when(e.at, now)}</td><td>${e.feed ? FEEDS[e.feed] : ''}</td><td class="${e.level}">${esc(e.text)}</td></tr>`,
        )
        .join('');
      parts.push(`<p style="margin:16px 0 0"><strong>Recent events</strong></p>
        <table><thead><tr><th>Time</th><th>Feed</th><th>What happened</th></tr></thead><tbody>${ev}</tbody></table>`);
    }
    sharedBox.innerHTML = parts.join('');
  }

  async function loadShared() {
    try {
      const res = await fetch('/api/forecasts', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      shared = await res.json();
      renderShared(shared);
    } catch {
      shared = null;
      sharedBox.innerHTML =
        '<div class="banner warn">The alerts container isn\'t running, so there are no shared forecasts: each browser fetches from Open-Meteo itself, using this connection\'s allowance.</div>';
    }
  }
  // ---- Air traffic, sampled from OpenSky by the alerts container ----
  const trafficBox = root.querySelector('#traffic');

  function renderTraffic(t, now) {
    const parts = [];
    if (t.lastError) {
      parts.push(`<div class="banner warn">${esc(t.lastError)}</div>`);
    }
    if (!t.samples) {
      parts.push(
        '<p class="muted">No samples yet: the first comes about 20 seconds after the container starts.</p>',
      );
      trafficBox.innerHTML = parts.join('');
      return;
    }
    const credits = t.creditsLeft != null ? `, ${t.creditsLeft} OpenSky credits left today` : '';
    parts.push(
      t.usedForTrails
        ? '<div class="banner ok">Used for the plane trail risk.</div>'
        : `<p class="muted">Not used for the plane trail risk yet: it starts by itself after ${t.readyDays} days of samples covering every hour.</p>`,
    );
    parts.push(
      `<p style="margin:0"><strong>${t.samples.toLocaleString('en-GB')}</strong> snapshot${t.samples === 1 ? '' : 's'} over ${t.days} day${t.days === 1 ? '' : 's'}, since ${when(t.since, now)}; ${t.hoursCovered} of 24 hours covered.</p>
       <p class="muted">Last snapshot ${when(t.lastSampleAt, now)}: ${t.lastCount} aircraft above 25,000 ft. Next ${when(t.nextAt, now)} (every ${t.everyMinutes} min${credits}).</p>`,
    );
    // UK clock hours, from the UTC hours the server counts in.
    const today = new Date(now);
    const ukHour = (h) =>
      Number(
        new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h),
        ).toLocaleString('en-GB', {
          timeZone: 'Europe/London',
          hour: '2-digit',
          hourCycle: 'h23',
        }),
      );
    const hours = t.byHour.map((v, h) => ({ v, uk: ukHour(h) })).sort((a, b) => a.uk - b.uk);
    const max = Math.max(1, ...hours.map((x) => x.v ?? 0));
    const bars = hours
      .map((x) =>
        x.v == null
          ? `<span class="none" style="height:4%" title="${String(x.uk).padStart(2, '0')}:00: no samples yet"></span>`
          : `<span style="height:${Math.max(3, (x.v / max) * 100).toFixed(0)}%" title="${String(x.uk).padStart(2, '0')}:00: ${x.v} aircraft on average"></span>`,
      )
      .join('');
    const labels = hours
      .map((x) => `<span>${x.uk % 3 === 0 ? String(x.uk).padStart(2, '0') : ''}</span>`)
      .join('');
    parts.push(
      `<p style="margin:12px 0 0"><strong>Average aircraft above 25,000 ft over the UK, by hour (UK time)</strong></p>
       <div class="bars">${bars}</div><div class="bar-labels">${labels}</div>`,
    );
    trafficBox.innerHTML = parts.join('');
  }

  async function loadTraffic() {
    try {
      const res = await fetch('/api/traffic', { cache: 'no-store' });
      if (res.status === 404) {
        trafficBox.innerHTML =
          '<p class="muted">Traffic sampling is turned off (ATMOS_TRAFFIC=off).</p>';
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      renderTraffic(await res.json(), Date.now());
    } catch {
      trafficBox.innerHTML =
        '<p class="muted">The alerts container isn\'t running, so there\'s no traffic sampling.</p>';
    }
  }

  const refresh = () => {
    loadShared();
    loadTraffic();
  };
  refresh();
  const timer = setInterval(refresh, 30_000);

  // ---- Browser API check ----
  const results = [];
  const rows = root.querySelector('#rows');
  const status = root.querySelector('#status');

  function record(check, outcome, detail, data = {}) {
    results.push({ check, outcome, detail, ...data });
    const tr = document.createElement('tr');
    const cls = outcome === 'ok' ? 'ok' : outcome === 'partial' ? 'partial' : 'fail';
    tr.innerHTML = `<td>${check}</td><td class="${cls}">${outcome}</td><td></td>`;
    tr.lastChild.textContent = detail;
    rows.append(tr);
  }

  async function get(url, as = 'json') {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      return { ok: false, blocked: true, error: `blocked (CORS or network): ${e.message}` };
    }
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    const base = { ok: res.ok, status: res.status, ms, bytes: text.length };
    if (!res.ok) return { ...base, error: text.slice(0, 300) };
    if (as === 'text') return { ...base, text };
    try {
      return { ...base, json: JSON.parse(text) };
    } catch {
      return { ...base, ok: false, error: 'not JSON: ' + text.slice(0, 120) };
    }
  }

  const om = (params) =>
    `${OM}?${new URLSearchParams({ latitude: LAT, longitude: LON, timezone: 'UTC', ...params })}`;

  /** Hours with a value, for every hourly key in a response. */
  function coverage(json) {
    const out = {};
    for (const [k, v] of Object.entries(json.hourly ?? {})) {
      if (k === 'time') continue;
      out[k] = v.filter((x) => x !== null).length;
    }
    return out;
  }

  /** Tries a list of variables in one request; on a 400, finds which are invalid. */
  async function probeVariables(model, vars, label) {
    const r = await get(om({ models: model, hourly: vars.join(','), forecast_days: 7 }));
    if (r.ok) {
      const cov = coverage(r.json);
      const empty = Object.entries(cov)
        .filter(([, n]) => n === 0)
        .map(([k]) => k);
      const hours = Math.max(0, ...Object.values(cov));
      record(
        `${model}: ${label}`,
        empty.length === 0 ? 'ok' : 'partial',
        `${vars.length} variables accepted; up to ${hours} h of data` +
          (empty.length ? `; all null: ${empty.join(', ')}` : ''),
        { model, label, elevation: r.json.elevation, coverage: cov, ms: r.ms, bytes: r.bytes },
      );
      return;
    }
    if (r.blocked) return record(`${model}: ${label}`, 'fail', r.error);
    // Find the invalid ones individually.
    const invalid = [];
    for (const v of vars) {
      const one = await get(om({ models: model, hourly: v, forecast_days: 1 }));
      if (!one.ok) invalid.push(v);
    }
    const valid = vars.filter((v) => !invalid.includes(v));
    if (valid.length > 0) {
      const r2 = await get(om({ models: model, hourly: valid.join(','), forecast_days: 7 }));
      const cov = r2.ok ? coverage(r2.json) : {};
      record(`${model}: ${label}`, 'partial', `invalid: ${invalid.join(', ')}`, {
        model,
        label,
        invalid,
        coverage: cov,
        firstError: r.error,
      });
    } else {
      record(`${model}: ${label}`, 'fail', r.error, { model, label, invalid });
    }
  }

  async function run() {
    root.querySelector('#run').disabled = true;
    results.length = 0;
    rows.innerHTML = '';
    const started = new Date().toISOString();

    status.textContent = 'Forecast models: surface variables…';
    for (const m of MODELS) await probeVariables(m, SURFACE, 'surface');

    status.textContent = 'Forecast models: pressure levels…';
    const pvars = PRESSURE.flatMap((p) => PRESSURE_VARS.map((v) => `${v}_${p}hPa`));
    for (const m of MODELS) await probeVariables(m, pvars, 'pressure levels');

    status.textContent = 'UKV height levels…';
    const ukv = MODELS[0];
    const okHeights = [];
    for (const h of HEIGHTS) {
      const r = await get(om({ models: ukv, hourly: `temperature_${h}m`, forecast_days: 1 }));
      if (r.ok && r.json.hourly?.[`temperature_${h}m`]?.some((x) => x !== null)) okHeights.push(h);
    }
    if (okHeights.length) {
      const hv = okHeights.flatMap((h) => [
        `temperature_${h}m`,
        `relative_humidity_${h}m`,
        `wind_speed_${h}m`,
      ]);
      await probeVariables(ukv, hv, 'height levels');
    }
    record(
      'UKV height levels with data',
      okHeights.length ? 'ok' : 'fail',
      okHeights.length ? okHeights.join(', ') + ' m' : 'none of the tried names worked',
      { heights: okHeights },
    );

    status.textContent = 'Multi-location batch…';
    const pts = [
      [56.244, -4.214],
      [56.819, -5.105],
      [57.195, -3.826],
      [54.432, -2.963],
      [53.119, -4.129],
      [54.214, -5.892],
      [57.289, -6.171],
      [55.956, -2.781],
      [51.947, -3.391],
      [60.25, -1.3],
    ];
    const batch = await get(
      `${OM}?${new URLSearchParams({
        latitude: pts.map((p) => p[0]).join(','),
        longitude: pts.map((p) => p[1]).join(','),
        models: MODELS.join(','),
        hourly: SURFACE.slice(0, 14).join(','),
        forecast_days: 5,
        timezone: 'UTC',
      })}`,
    );
    record(
      'Batch: 10 points × 5 models × 14 variables',
      batch.ok && Array.isArray(batch.json) ? 'ok' : 'fail',
      batch.ok
        ? `${Array.isArray(batch.json) ? batch.json.length : 1} locations in ${batch.ms} ms, ${Math.round(batch.bytes / 1024)} KB; keys look like: ${Object.keys(
            (Array.isArray(batch.json) ? batch.json[0] : batch.json).hourly,
          )
            .slice(1, 4)
            .join(', ')}`
        : batch.error,
      { ms: batch.ms, bytes: batch.bytes },
    );

    status.textContent = 'Ensembles…';
    for (const m of [
      'ukmo_global_ensemble_20km',
      'ukmo_uk_ensemble_2km',
      'ecmwf_ifs025',
      'icon_seamless',
    ]) {
      const r = await get(
        `https://ensemble-api.open-meteo.com/v1/ensemble?${new URLSearchParams({
          latitude: LAT,
          longitude: LON,
          models: m,
          hourly: 'cloud_cover_low,wind_speed_10m,temperature_2m',
          forecast_days: 3,
        })}`,
      );
      const members = r.ok
        ? Object.keys(r.json.hourly).filter((k) => k.startsWith('cloud_cover_low')).length
        : 0;
      record(
        `Ensemble: ${m}`,
        r.ok ? 'ok' : 'fail',
        r.ok ? `${members} members of cloud_cover_low` : r.error,
        {
          members,
        },
      );
    }

    status.textContent = 'Historical forecasts…';
    const hist = await get(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${new URLSearchParams({
        latitude: LAT,
        longitude: LON,
        models: MODELS.join(','),
        hourly: 'cloud_cover_low,temperature_2m,temperature_850hPa',
        start_date: '2025-12-01',
        end_date: '2025-12-02',
      })}`,
    );
    record(
      'Historical forecast API (Dec 2025)',
      hist.ok ? 'ok' : 'fail',
      hist.ok ? JSON.stringify(coverage(hist.json)) : hist.error,
      { coverage: hist.ok ? coverage(hist.json) : null },
    );

    status.textContent = 'Other sources…';
    const others = [
      ['NOAA Kp observed', 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'],
      [
        'NOAA Kp forecast',
        'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
      ],
      [
        'AuroraWatch UK status',
        'https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml',
        'text',
      ],
      [
        'MET Norway Locationforecast',
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
      ],
      ['OpenFreeMap style', 'https://tiles.openfreemap.org/styles/liberty'],
      [
        'AWS terrain tile',
        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/500/313.png',
        'text',
      ],
      ['Mapterhorn tile', 'https://tiles.mapterhorn.com/10/500/313.webp', 'text'],
      [
        'Overpass (paths and car parks)',
        'https://overpass-api.de/api/interpreter?data=' +
          encodeURIComponent('[out:json];nw["amenity"="parking"](around:500,56.7656,-5.0045);out;'),
      ],
      [
        'Open-Meteo elevation',
        `https://api.open-meteo.com/v1/elevation?latitude=${LAT}&longitude=${LON}`,
      ],
      [
        'KNMI HARMONIE Europe (third model)',
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&models=knmi_harmonie_arome_europe&hourly=cloud_cover_low,temperature_850hPa&forecast_days=3`,
      ],
      [
        'NOAA OVATION aurora nowcast',
        'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
      ],
      ['postcodes.io postcode', 'https://api.postcodes.io/postcodes/EH11YZ'],
      ['postcodes.io outcode', 'https://api.postcodes.io/outcodes/EH45'],
      [
        'Open-Meteo place search',
        'https://geocoding-api.open-meteo.com/v1/search?name=Peebles&count=5&language=en&countryCode=GB',
      ],
    ];
    for (const [name, url, as] of others) {
      const r = await get(url, as);
      record(
        name,
        r.ok ? 'ok' : 'fail',
        r.ok ? `${r.status}, ${r.ms} ms, ${r.bytes} bytes` : (r.error ?? `HTTP ${r.status}`),
        {
          status: r.status,
        },
      );
    }

    const out = {
      ranAt: started,
      userAgent: navigator.userAgent,
      origin: location.origin,
      shared,
      results,
    };
    root.querySelector('#out').value = JSON.stringify(out, null, 1);
    root.querySelector('#copy').disabled = false;
    root.querySelector('#run').disabled = false;
    status.textContent = 'Done.';
  }

  root.querySelector('#run').addEventListener('click', run);
  root.querySelector('#copy').addEventListener('click', async () => {
    const text = root.querySelector('#out').value;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied.';
    } catch {
      root.querySelector('#out').select();
      status.textContent = 'Select all in the box below and copy.';
    }
  });

  return () => clearInterval(timer);
}
