import React from 'react';
import { BarGauge } from './gauges.jsx';
import { Icon } from './icons.jsx';
import {
  ADDON_TRANSFERS_PER_24H,
  BASE_TRANSFERS_PER_24H,
  TRANSFER_WINDOW_HOURS,
  countTransfersLast24h,
  transferWindow,
} from '../lib/product.js';

export function workspaceTransferWindow(state, me) {
  const billing = { ...me?.subscription, ...state?.billing };
  const used = countTransfersLast24h(state?.capsules);
  return transferWindow({
    usedLast24h: used,
    extraTransfersAddon: Boolean(billing.extraTransfersAddon),
    planId: billing.planId || billing.plan,
  });
}

export function TransferWindowPanel({
  state,
  me,
  onUpgrade,
  busy,
  compact = false,
  navigate,
}) {
  const tw = workspaceTransferWindow(state, me);
  const tone = tw.atLimit ? 'danger' : tw.remaining === 0 || tw.used >= tw.allowance - 0.01 ? 'warn' : 'ok';

  return (
    <div className="pb-card" style={{ marginBottom: compact ? 0 : 14 }}>
      <BarGauge
        used={tw.used}
        cap={tw.allowance}
        label={`Transfers · rolling ${TRANSFER_WINDOW_HOURS}h`}
        usedLabel={`${tw.used}`}
        capLabel={`${tw.allowance} allowed`}
        tone={tone}
        mocked
      />
      <p className="pb-muted" style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5 }}>
        Plan allowance: <strong>{tw.allowance}</strong> capsule transfer{tw.allowance === 1 ? '' : 's'} / {TRANSFER_WINDOW_HOURS}h
        {' · '}
        {tw.extraTransfersAddon
          ? `Extra transfers add-on on (up to ${ADDON_TRANSFERS_PER_24H}).`
          : `$7 includes 1 / ${TRANSFER_WINDOW_HOURS}h. $17 includes 3 / day.`}
        {' '}
        {tw.remaining === 0 ? 'No slots left in this window.' : `${tw.remaining} remaining.`}
      </p>
      {!tw.extraTransfersAddon && (
        <div className="pb-callout warn" style={{ marginTop: 12 }}>
          <Icon name="clock" size={16} />
          <div>
            <strong>Need up to {ADDON_TRANSFERS_PER_24H} transfers / {TRANSFER_WINDOW_HOURS}h?</strong>
            <p>
              Extra transfers add-on · {tw.addonPriceLabel} for up to {ADDON_TRANSFERS_PER_24H} / {TRANSFER_WINDOW_HOURS}h
              {' '}($3 on Starter, $5 on Daily / Scale).
            </p>
            <div className="pb-inline" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="pb-btn pb-btn-primary"
                disabled={busy}
                onClick={() => onUpgrade?.()}
              >
                {busy ? 'Opening Square…' : `Upgrade · ${tw.addonPriceLabel}`}
              </button>
              {navigate && (
                <button type="button" className="pb-btn" onClick={() => navigate('account', { tab: 'billing' })}>
                  Plan details
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
