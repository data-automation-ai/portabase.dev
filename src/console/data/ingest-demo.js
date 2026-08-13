/**
 * Demo event source for the ingestion monitor.
 *
 * Replays a realistic capture so `/app?demo=1` shows the monitor working without a live
 * Supabase project. Shape and proportions are taken from the real DataAutomation capture
 * (588 tables, ~891 MB of table data, 15 973 Storage objects) so the size-weighted meter
 * demonstrates its actual point: a handful of tables dominate the run.
 */

const DEMO_TABLES = [
  ['public.order_history_lcmd', 142.5, 1_240_000],
  ['musicsupplies.order_history_lcmd', 132.7, 1_180_000],
  ['public.tbl_inv_details', 73.0, 610_000],
  ['public.accounts_lcmd', 71.8, 320_000],
  ['musicsupplies.tbl_inv_details', 61.1, 505_000],
  ['public.staff_usage_log', 52.4, 890_000],
  ['public.web_analytics_events', 42.5, 760_000],
  ['public.inventory_ledger', 35.9, 410_000],
  ['public.tbl_inv_headers', 21.7, 96_000],
  ['public.agg_customer_sku_sales_periods', 17.4, 210_000],
  ['public.tbl_po_details', 15.5, 88_000],
  ['musicsupplies.prospect_google_reviews', 13.5, 64_000],
  ['public.customers', 9.2, 41_000],
  ['public.promo_codes', 4.1, 2_400],
  ['public.sms_log', 3.3, 18_000],
  ['public.audit_events', 2.6, 31_000],
  ['public.sessions', 1.4, 12_000],
  ['public.feature_flags', 0.2, 90],
  ['public.migrations', 0.1, 240],
  ['public.settings', 0.05, 30],
];

const MB = 1024 * 1024;

export function buildDemoEvents() {
  const tables = DEMO_TABLES.map(([item, mb, rows]) => ({ item, bytes: Math.round(mb * MB), rows }));
  // The real project has 588 tables; the manifest lists the big ones and the rest are tiny.
  const listedBytes = tables.reduce((s, t) => s + t.bytes, 0);
  const events = [
    { phase: 'scan', item: 'ekklokrukxmqlahtonnc' },
    {
      phase: 'database-manifest',
      count: 588,
      totalRows: 3_995_818,
      totalBytes: Math.round(listedBytes * 1.06), // remaining 568 small tables
      tables,
    },
  ];
  for (const t of tables) events.push({ phase: 'database', item: t.item, rows: t.rows });

  const storageTotal = 15_973;
  const buckets = ['nysme-models', 'email2invoice-attachments', 's3-staging', 'nys-massage-diagrams', 'listing-images'];
  for (let i = 1; i <= 40; i += 1) {
    events.push({
      phase: 'storage',
      item: `${buckets[i % buckets.length]}/object-${String(i).padStart(5, '0')}.bin`,
      bytes: Math.round((0.4 + (i % 7) * 0.9) * MB),
      completed: Math.round((i / 40) * storageTotal),
      total: storageTotal,
    });
  }
  for (const name of ['capsule-smoke', 'square-webhook', 'send-sms', 'audit-log']) {
    events.push({ phase: 'functions', item: name });
  }
  events.push({ phase: 'package' }, { phase: 'encrypt' }, { phase: 'transfer', item: 'aws' });
  events.push({ phase: 'done', status: 'COMPLETE' });
  return events;
}

/**
 * Subscribe-shaped demo source: feeds events on a timer and returns an unsubscribe function.
 * Pacing is uneven on purpose — a real capture stalls on big tables.
 */
export function demoIngestSource(onEvent, { speed = 1 } = {}) {
  const events = buildDemoEvents();
  let i = 0;
  let timer = null;
  const tick = () => {
    if (i >= events.length) return;
    const event = events[i++];
    onEvent(event);
    // Large tables take proportionally longer, so the meter visibly crawls through them.
    const weight = event.phase === 'database' && event.rows ? Math.min(900, 90 + event.rows / 2200) : 110;
    timer = setTimeout(tick, weight / speed);
  };
  timer = setTimeout(tick, 200);
  return () => { if (timer) clearTimeout(timer); };
}
