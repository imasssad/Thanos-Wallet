# MultX Partner Acceptance Checklist

**PRE-RELEASE:** complete on an authorized test network only. MultX remains
disabled until Autha and KaJ Labs approve the exact production release.

Partner: ____________________

Technical owner: ____________________

Application commit: ____________________

MultX tag / 40-character commit: ____________________ / ____________________

SDK version / SHA-256: ____________________ / ____________________

Manifest version / SHA-256: ____________________ / ____________________

## Configuration

- [ ] Feature defaults to disabled.
- [ ] Manifest identity and integrity are pinned.
- [ ] No historical bridge or token address is hard-coded.
- [ ] Exact source/destination chain, bridge, token, and route are validated.
- [ ] RPC/API endpoints are approved and use HTTPS.
- [ ] No privileged MultX key or infrastructure credential is present.

## Functional tests

- [ ] Wallet connect and exact source-network check pass.
- [ ] On-chain token decimals are handled as base units.
- [ ] Exact-amount approval succeeds.
- [ ] Lock receipt and complete transfer identity are persisted.
- [ ] Restart resumes observation without resubmitting the lock.
- [ ] Destination release is independently verified.
- [ ] Product balance/action remains blocked until settlement.
- [ ] History and status UI distinguish pending, failed, and completed.

## Negative tests

- [ ] Wrong chain fails closed.
- [ ] Unknown token and unsupported route fail closed.
- [ ] Invalid/zero amount and insufficient balance fail safely.
- [ ] Pause and cap exhaustion are handled.
- [ ] Duplicate click is controlled.
- [ ] Temporary `404`, `429`, timeout, and `5xx` recover safely.
- [ ] Failed/reorged/replaced source transaction cannot become completed.
- [ ] Invalid destination receipt cannot credit funds.
- [ ] Emergency manifest disable removes state-changing actions.

## Security and operations

- [ ] Logs and telemetry contain no secrets or raw credentials.
- [ ] Alerts exist for stalls, failures, identity mismatches, and manifest drift.
- [ ] Support runbook tells staff never to ask for seed phrases/private keys.
- [ ] Disable and rollback drill passed.
- [ ] Named incident owner and backup are recorded privately.

## Approval

Partner engineering approval: ____________________

Partner security approval: ____________________

KaJ Labs release approval: ____________________

Autha final report reference: ____________________

Production activation time (UTC): ____________________

