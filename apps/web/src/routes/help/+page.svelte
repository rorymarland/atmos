<script lang="ts">
  import { alerts } from '#lib/alerts.svelte.ts';

  const SECTIONS = [
    ['start', 'Getting started'],
    ['map', 'The map'],
    ['look-for', 'Choosing what to look for'],
    ['trip', 'Planning the trip'],
    ['hill', 'A hill’s panel'],
    ['view', 'The view'],
    ['line-up', 'Lining up the sun or moon'],
    ['places', 'Your own places'],
    ['alerts', 'Alerts'],
    ['phones', 'On a phone'],
    ['faq', 'Questions'],
  ] as const;

  const CONDITIONS: { group: string; items: [string, string][] }[] = [
    {
      group: 'Light and sky',
      items: [
        ['Golden-hour sky', 'Mid and high cloud to catch colour at sunrise or sunset, with a clear gap towards the sun.'],
        ['Dramatic light', 'Broken cloud and passing showers with a low sun: shafts of light and moving skies.'],
        ['Clear air and long views', 'Crisp, clean air for distant views, often just behind a cold front.'],
        ['Wave and lenticular clouds', 'Lens-shaped clouds over the hills when strong winds cross the ridges.'],
        ['Rainbows', 'Showers about and the sun out behind you, low in the sky.'],
      ],
    },
    {
      group: 'Cloud and water',
      items: [
        ['Cloud inversion', 'Standing above a sea of cloud at dawn.'],
        ['Brocken spectre and glory', 'Your shadow on the cloud below, ringed by a rainbow glory.'],
        ['Valley mist', 'Mist in the glens at dawn, shot from in it or beside it.'],
        ['Still reflections', 'Calm air for mirror reflections, only where there’s a loch or lake nearby.'],
        ['Waterfalls in spate', 'Rivers and falls running full after heavy rain.'],
      ],
    },
    {
      group: 'Winter',
      items: [
        ['Snow on the tops', 'Fresh snow on the summit, cold enough to stay, with the tops clear.'],
        ['Fresh snow, blue sky', 'The day after a snowfall: the snow has stopped and the sky is blue.'],
        ['Alpenglow on snow', 'Snowy summits lit pink and gold by a low sun.'],
        ['Hoar frost', 'Frost on grass and trees after a cold, clear, still night.'],
        ['Frozen lochs', 'Ice on lochans after a cold spell.'],
      ],
    },
    {
      group: 'Night',
      items: [
        ['Milky Way and stars', 'Clear, dark, moonless skies.'],
        ['Aurora', 'Enough geomagnetic activity for your latitude, with a clear, dark sky.'],
        ['Noctilucent clouds', 'Electric-blue wisps low in the north on summer nights, late May to early August.'],
      ],
    },
    {
      group: 'On foot',
      items: [['Hill walking', 'Safe, pleasant conditions on the summit: wind, rain, cloud base and wind chill.']],
    },
  ];
</script>

<svelte:head><title>How to use Atmos</title></svelte:head>

<div class="page">
  <h1>How to use Atmos</h1>
  <p class="lead">
    Atmos looks at the weather for about 2,200 UK hills and tells you where and when conditions look good for
    walking and landscape photography, and why. This page walks through it.
  </p>

  <nav class="contents" aria-label="On this page">
    {#each SECTIONS as [id, label] (id)}
      {#if id !== 'alerts' || alerts.status}<a href="#{id}">{label}</a>{/if}
    {/each}
  </nav>

  <section id="start">
    <h2>Getting started</h2>
    <ol class="steps">
      <li>
        <strong>Set your home</strong> in <a href="/settings">Settings</a>: a postcode or place name. It stays in your
        browser and is used for drive times. You can change today’s start point at any time without changing home.
      </li>
      <li>
        <strong>Pick a day</strong> (today and the next four) and <strong>tick what you’re after</strong> under
        <em>Look for</em> on the map page. Not sure? Try the <em>Filter quiz</em>.
      </li>
      <li>
        <strong>Read the map.</strong> Each dot is a hill: green is Go, amber Maybe, red No. The blue ring is the best
        bet for what you’ve ticked.
      </li>
      <li>
        <strong>Click a hill</strong> to see why it scores as it does, when to leave, the walk up, the view from the top
        and more.
      </li>
    </ol>
  </section>

  <section id="map">
    <h2>The map</h2>
    <dl>
      <dt>Dots</dt>
      <dd>
        One per hill (and per place of your own). <strong>Go</strong> means the conditions you’ve ticked look good,
        <strong>Maybe</strong> worth a look, <strong>No</strong> unlikely. The best bet has a blue ring.
      </dd>
      <dt>Where to go</dt>
      <dd>
        The panel on the right (at the bottom on a phone) lists the best bet, then every hill by photo score. Hills
        that need an earlier start than you’d like are listed separately.
      </dd>
      <dt>Search</dt>
      <dd>Top left: hills, lochs, UK places and postcodes.</dd>
      <dt>The pin and the sun and moon</dt>
      <dd>
        The dark pin draws where the sun and moon rise and set from there, and where they are now. It sits on the
        hill you’ve opened; click the map or drag the pin to see the light from anywhere else, and
        <em>Save this spot</em> to keep it as one of your places.
      </dd>
      <dt>The timeline</dt>
      <dd>
        Along the bottom: the sun and moon through the day. Drag along it to move through the day; the lines on the
        map follow. Dots mark each condition’s best hour. <em>Hide sun and moon</em> folds it away.
      </dd>
    </dl>
  </section>

  <section id="look-for">
    <h2>Choosing what to look for</h2>
    <p>
      Under <em>Look for</em>, tick the conditions you’re after and the parts of the day (morning, daytime, evening,
      night). Hills are ranked by how well they suit what’s ticked. <em>Reset filters</em> goes back to the start, and
      the <em>Filter quiz</em> asks a few questions and ticks things for you.
    </p>
    {#each CONDITIONS as g (g.group)}
      <h3>{g.group}</h3>
      <dl class="conditions">
        {#each g.items as [name, what] (name)}
          <dt>{name}</dt>
          <dd>{what}</dd>
        {/each}
      </dl>
    {/each}
    <p class="small muted">
      Midges are shown as a warning from late May to September, not as something to look for.
    </p>
    <h3>Avoid plane trails</h3>
    <p>
      For conditions where a clean sky matters, Atmos warns when plane trails are likely to linger, and with
      <em>Avoid plane trails</em> ticked it ranks those places and times lower. Nothing is hidden: trails are hard to
      forecast.
    </p>
  </section>

  <section id="trip">
    <h2>Planning the trip</h2>
    <dl>
      <dt>Start point</dt>
      <dd>
        Under <em>Your trip</em>: home, <em>Use my location</em>, or <em>Pick on map</em>. Drive times are estimates from
        the straight-line distance and typical road speeds, in miles, with a Google Maps link for the real route.
      </dd>
      <dt>Be there for</dt>
      <dd>
        Blue hour, golden hour, sunrise or sunset: Atmos works out when to leave to be in place in time, allowing for
        getting ready and being early (both set in <a href="/settings">Settings</a>).
      </dd>
      <dt>Walking</dt>
      <dd>
        With <em>Hill walking</em> ticked, choose <em>Start walking</em> (at the best weather, or a time you pick) and
        <em>Down by</em>: before sunset, before dark, or any time. Atmos picks the walk window and warns you to take a
        head torch when you’d finish in the dark.
      </dd>
    </dl>
  </section>

  <section id="hill">
    <h2>A hill’s panel</h2>
    <p>Click any hill (or search for one) to open it. From the top:</p>
    <dl>
      <dt>Verdict and confidence</dt>
      <dd>
        Go, Maybe or No, with how sure Atmos is: <strong>high</strong> when the weather models agree,
        <strong>low</strong> when they don’t. More than two days ahead it’s never better than medium.
      </dd>
      <dt>Photo score</dt>
      <dd>Out of 100, from the conditions you’ve ticked.</dd>
      <dt>Conditions</dt>
      <dd>
        Every condition for every part of the day. Pick one to see the reasons behind it (wind, cloud, humidity and
        so on), each model’s view, and how many runs of the Met Office and ECMWF ensembles agree.
      </dd>
      <dt>The walk</dt>
      <dd>
        The quickest route up from a car park or road, from OpenStreetMap paths and terrain, with a time at your
        walking pace.
      </dd>
      <dt>Your trip</dt>
      <dd>When to leave, the drive, the walk in, and when you’ll be back.</dd>
      <dt>Hour by hour</dt>
      <dd>The forecast through the day, and the air above the valley at the best hour (where any inversion sits).</dd>
      <dt>Line it up</dt>
      <dd>Where to stand for the sun or moon to sit on the summit: see <a href="#line-up">below</a>.</dd>
      <dt>Alert me</dt>
      <dd>
        {#if alerts.status}An email when this hill looks good for the condition you’re looking at: see
          <a href="#alerts">Alerts</a>.{:else}Email alerts, when the Atmos alerts service is running.{/if}
      </dd>
    </dl>
  </section>

  <section id="view">
    <h2>The view</h2>
    <p>
      With a hill open (or the pin dropped anywhere), a strip above the timeline shows what you’d see from there: the
      skyline and ridges out to 150 km, worked out from terrain heights, with hills named.
    </p>
    <ul>
      <li><strong>Turn</strong> by dragging the strip, with the arrow keys, or by dragging the round handle on the blue wedge on the map. They always match.</li>
      <li><strong>Lenses</strong>: 24, 50, 100 and 200 mm set how much you see, roughly what that lens would frame on a full-frame camera.</li>
      <li><strong>The sun and moon</strong> follow the timeline, at their true size, hidden behind hills when they’re behind them, with the moon’s phase. Faint lines show their path through the day with the hours marked.</li>
      <li>If the sun or moon is out of view, a marker at the edge turns you to face it.</li>
      <li>A hill’s name lights up with <strong>sun on top</strong> or <strong>moon on top</strong> when either sits on its summit.</li>
      <li>Tap a name to face that hill; tap it again to open it.</li>
      <li>From an open hill the view is from its summit; drop the pin anywhere else for the view from the ground there.</li>
    </ul>
    <p class="small muted">
      Each new spot takes a second or two to work out. <em>Hide view</em> folds it away.
    </p>
  </section>

  <section id="line-up">
    <h2>Lining up the sun or moon</h2>
    <p>
      In a hill’s panel, <em>Line it up</em> with <em>Sun</em> or <em>Moon</em> works out every spot within 40 km
      where the sun or moon will sit right on the summit that day, and when. They show on the map as small dots
      (orange for the sun, blue for the moon) with times, and in a list with distance, direction, height and
      directions. Spots where a nearer hill hides the summit are left out.
    </p>
    <p>
      To check one: drag the pin to the spot, move the timeline to the time, and the view should show the sun or moon
      on the summit. The times are for the centre of the disc, which moves its own width in about two minutes, so be
      there early.
    </p>
  </section>

  <section id="places">
    <h2>Your own places</h2>
    <p>
      Spots of your own (a crag, a viewpoint, a bit of lochside) are scored for every condition just like the hills.
      Add one in <a href="/places">Places</a>, or click the map and choose <em>Save this spot</em>.
    </p>
  </section>

  {#if alerts.status}
    <section id="alerts">
      <h2>Alerts</h2>
      <p>
        Get an email when a hill or place looks good. Use <em>Alert me</em> in its panel, or set alerts up in
        <a href="/alerts">Alerts</a>: choose the places, the conditions (any of them, or all on the same day), how
        good it needs to be (Go only, or Maybe or better), the parts of the day and how far ahead to look.
      </p>
      <p>
        Alerts sent as soon as something turns up are checked every hour, but never sent between 22:00 and 06:00:
        anything found overnight waits until 06:00. You can also have a daily summary at a time you choose. Emails
        only go when there’s something new (or something has fallen through), with the forecast, the best hours,
        when to leave and any plane trail warning.
      </p>
    </section>
  {/if}

  <section id="phones">
    <h2>On a phone</h2>
    <ul>
      <li>The results and a hill’s panel slide up from the bottom, over the lower part of the map.</li>
      <li><em>Look for</em> and <em>Your trip</em> start folded to save space: tap to open.</li>
      <li>The key, the timeline and the view each fold away from the bar under the search box.</li>
      <li>Pinch to zoom the map.</li>
    </ul>
  </section>

  <section id="faq">
    <h2>Questions</h2>
    <details>
      <summary>How accurate is it?</summary>
      <p>
        As good as the weather models it blends: the Met Office’s, ECMWF’s and, for the first couple of days, KNMI’s
        HARMONIE. Fog, low cloud and inversions are among the hardest things for any model to get right, so treat a
        Go as a good bet, not a promise, and watch the confidence.
      </p>
    </details>
    <details>
      <summary>How up to date are the forecasts?</summary>
      <p>
        They update by themselves as new model runs come out, every few hours, so there’s nothing to refresh. The
        results panel says how old the forecasts are.
      </p>
    </details>
    <details>
      <summary>Why does a hill say Go but with low confidence?</summary>
      <p>
        The best guess looks good but the models disagree. It may well happen; check again nearer the time.
      </p>
    </details>
    <details>
      <summary>Why is a hill grey, or showing no data?</summary>
      <p>
        Its forecast hasn’t loaded yet, or there’s nothing to score: reflections and frozen lochs, for example, need
        still water nearby. Wait a moment, or pick another condition.
      </p>
    </details>
    <details>
      <summary>Why is the drive time different from Google Maps?</summary>
      <p>
        Atmos estimates from straight-line distance and typical road speeds, because there’s no free route planner it
        can use. It’s a rough guide; the Google Maps link gives the real route and time.
      </p>
    </details>
    <details>
      <summary>What’s the haze in a sunset’s reasons?</summary>
      <p>
        How much dust, smoke or pollution is in the air (from the Copernicus atmosphere forecast). Heavy haze mutes
        sunset colour and fades distant hills; it’s named when it’s Saharan dust.
      </p>
    </details>
    <details>
      <summary>Why the plane trail warning?</summary>
      <p>
        Where the air high up is cold and moist enough, aircraft trails linger and spread, which can spoil a clean sky.
        It’s a warning only; tick <em>Avoid plane trails</em> to rank those times lower.
      </p>
    </details>
    <details>
      <summary>Does Atmos track me or keep my details?</summary>
      <p>
        No. Your home and settings stay in your own browser. There are no accounts, no ads and no analytics. Alerts
        just need an email address to send to.
      </p>
    </details>
    <details>
      <summary>Can I use it in dark mode, or in mph?</summary>
      <p>Yes: both are in <a href="/settings">Settings</a>, along with your walking pace and trip timings.</p>
    </details>
    <details>
      <summary>Can I move my settings to another device?</summary>
      <p>Yes: <a href="/settings">Settings</a> has <em>Back up and move</em> to export them and import them elsewhere.</p>
    </details>
    <details>
      <summary>Why does it only cover the UK?</summary>
      <p>
        The hill lists, the weather models it leans on most (the Met Office’s) and the walking data are all UK-focused.
        Republic of Ireland hills are left out.
      </p>
    </details>
  </section>

  <p class="safety">
    Atmos is a guide, not a safety service. Always check the
    <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain" target="_blank" rel="noopener">Met Office mountain forecast</a>
    and <a href="https://www.mwis.org.uk/" target="_blank" rel="noopener">MWIS</a> before you go, and turn back if the hill
    disagrees with the forecast.
  </p>
</div>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 20px 48px;
    display: grid;
    gap: 14px;
  }
  .lead {
    font-size: 1.05rem;
    max-width: 62ch;
  }
  .contents {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 10px 0 12px;
    border-bottom: 1px solid var(--line);
    font-size: 0.92rem;
  }
  section {
    display: grid;
    gap: 10px;
    scroll-margin-top: 70px;
  }
  h2 {
    margin: 16px 0 0;
  }
  h3 {
    margin: 8px 0 0;
    font-size: 1rem;
  }
  p,
  li,
  dd {
    max-width: 66ch;
  }
  .steps {
    display: grid;
    gap: 8px;
    padding-left: 1.3em;
    margin: 0;
  }
  ul {
    display: grid;
    gap: 6px;
    padding-left: 1.2em;
    margin: 0;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(8em, 12em) 1fr;
    gap: 8px 16px;
    margin: 0;
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0;
  }
  .conditions {
    font-size: 0.95rem;
  }
  details {
    border-bottom: 1px solid var(--line);
    padding: 8px 0;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  details p {
    margin: 8px 0 4px;
  }
  .safety {
    border-left: 3px solid var(--gold);
    padding-left: 12px;
    margin-top: 12px;
  }
  @media (max-width: 560px) {
    dl {
      grid-template-columns: 1fr;
      gap: 2px;
    }
    dd {
      margin-bottom: 8px;
    }
  }
</style>
