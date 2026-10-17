import { useState } from 'react';
import {
  AIMode,
  PROPOSAL_STATE_LABEL,
  ProposalState,
  SignerType,
  formatTimestamp,
  type Address,
} from '@litho-vault/sdk';
import { useMultisig } from '../context';
import { useAction, useAsync } from '../hooks';
import { AddressText, Button, Card, ErrorText, Icon, KeyValue, Notice, Pill, Screen, Spinner } from '../ui';
import { stateTone } from './VaultScreen';

const RECOMMENDATION = ['Allow', 'Review', 'Block'];
const AI_MODE = ['Off', 'Advisory', 'Required review', 'Policy guard'];

/** The proposal screen of LEP100-15 §83, in its order, then the actions. */
export function ProposalScreen({ address, id, onBack }: { address: Address; id: bigint; onBack?: () => void }) {
  const { client, chainId, account, canSign, cannotSignReason, openUrl, explorerTx } = useMultisig();
  const data = useAsync(async () => {
    const [view, snapshot] = await Promise.all([client.proposal(address, id), client.snapshot(address)]);
    const executedTx = view.details.state === ProposalState.EXECUTED ? await client.executionTx(address, id) : null;
    return { view, snapshot, executedTx };
  }, [client, address, id]);
  const action = useAction();
  const [acknowledged, setAcknowledged] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (data.loading && !data.data) return <Screen title={`Proposal #${id}`} onBack={onBack}><Spinner label="Reading the proposal and simulating it" /></Screen>;
  if (!data.data) return <Screen title={`Proposal #${id}`} onBack={onBack}><ErrorText error={data.error} /></Screen>;
  const { view, snapshot, executedTx } = data.data;
  const { review, details, fields } = view;
  const field = (key: string) => fields.find((f) => f.key === key)?.value ?? '—';
  const state = details.state;
  const open = state === ProposalState.PENDING || state === ProposalState.QUEUED || state === ProposalState.READY;
  const me = account?.toLowerCase();
  const mine = details.approvals.find((a) => a.signer.toLowerCase() === me);
  const isProposer = !!me && details.proposal.proposer.toLowerCase() === me;
  const approvedCount = details.approvals.filter((a) => a.approved).length;
  const required = Number(details.status.requiredApprovals);
  const enoughWithRelayed = state === ProposalState.PENDING && view.relayedValid > 0 && approvedCount + view.relayedValid >= required;
  const needsAck = review.requiresAcknowledgement && !acknowledged;
  const assessment = details.assessment;

  const act = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setDone(null);
    const result = await action.run(label, fn);
    if (result !== undefined) {
      setDone(success);
      data.reload();
    }
  };

  const rows = [
    { key: 'action', label: 'Action', value: review.actionType },
    { key: 'asset', label: 'Asset', value: field('asset') },
    { key: 'amount', label: 'Amount', value: field('amount') },
    {
      key: 'recipient',
      label: 'Recipient',
      value: review.decodedCalls.some((d) => d.recipient) ? (
        <span className="tms-stack">
          {[...new Set(review.decodedCalls.flatMap((d) => (d.recipient ? [d.recipient] : [])))].map((r) => (
            <AddressText key={r} address={r} full />
          ))}
        </span>
      ) : (
        'None'
      ),
    },
    { key: 'network', label: 'Network', value: `${client.network.chain.name} (chain ${chainId})` },
    { key: 'fee', label: 'Estimated fee', value: field('fee') },
    { key: 'contract', label: 'Contract', value: field('contract'), tone: review.unknownContractCall ? ('bad' as const) : undefined },
    { key: 'function', label: 'Function', value: field('function') },
    {
      key: 'calldata',
      label: 'Calldata',
      value: (
        <span className="tms-stack">
          <span className="tms-pre">{field('decoded')}</span>
          <details>
            <summary>Raw calldata</summary>
            <span className="tms-pre tms-mono">{field('raw')}</span>
          </details>
        </span>
      ),
    },
    {
      key: 'simulation',
      label: 'Simulation',
      value: review.simulation.summary,
      tone: review.simulation.status === 'success' ? ('good' as const) : review.simulation.status === 'failed' ? ('bad' as const) : ('warn' as const),
    },
    {
      key: 'approvals',
      label: 'Approvals',
      value: (
        <ul className="tms-approvals" data-testid="tms-approvals">
          {details.approvals
            .filter((a) => a.type !== SignerType.RECOVERY)
            .map((a) => (
              <li key={a.signer} className={a.approved ? 'tms-approved' : ''}>
                <span aria-hidden="true">{a.approved ? '✓' : '○'}</span>
                <AddressText address={a.signer} />
                {a.signer.toLowerCase() === me && <Pill tone="info">You</Pill>}
              </li>
            ))}
          {view.relayedValid > 0 && <li className="tms-muted">+ {view.relayedValid} signed without gas, not yet submitted</li>}
        </ul>
      ),
    },
    { key: 'required', label: 'Required threshold', value: `${approvedCount} of ${field('required')}` },
    {
      key: 'ai',
      label: 'AI risk assessment',
      value: assessment
        ? `Risk ${assessment.riskScore.toLocaleString()} / 10,000 · ${RECOMMENDATION[assessment.recommendation] ?? 'Unknown'} · valid until ${formatTimestamp(assessment.expiresAt)}`
        : snapshot.aiConfig.mode === AIMode.OFF
          ? 'AI protection is off for this multisig'
          : `No assessment yet (AI mode: ${AI_MODE[snapshot.aiConfig.mode] ?? 'unknown'})`,
    },
    { key: 'warnings', label: 'Policy warnings', value: <span className="tms-pre">{field('warnings')}</span>, tone: review.warnings.some((w) => w.level === 'danger') ? ('bad' as const) : review.warnings.length ? ('warn' as const) : undefined },
    { key: 'expiration', label: 'Expiration', value: field('timing') },
    {
      key: 'tx',
      label: 'Transaction hash',
      value: executedTx ? (
        <span className="tms-address">
          <span className="tms-mono">{executedTx.slice(0, 12)}…{executedTx.slice(-8)}</span>
          {explorerTx(executedTx) && (
            <button type="button" className="tms-icon-btn tms-icon-btn-sm" aria-label="Open in explorer" onClick={() => openUrl(explorerTx(executedTx)!)}>
              <Icon name="link" size={14} />
            </button>
          )}
        </span>
      ) : state === ProposalState.EXECUTED ? (
        'Executed (hash not found)'
      ) : (
        'Not executed yet'
      ),
    },
  ];

  return (
    <Screen
      title={
        <span className="tms-title-row">
          Proposal #{String(id)} <Pill tone={stateTone(state)} testId="tms-state">{PROPOSAL_STATE_LABEL[state]}</Pill>
        </span>
      }
      subtitle={
        <span>
          Proposed by <AddressText address={details.proposal.proposer} /> on {formatTimestamp(details.proposal.createdAt)}
        </span>
      }
      onBack={onBack}
    >
      {review.warnings
        .filter((w) => w.level === 'danger')
        .map((w) => (
          <Notice tone="bad" key={`${w.code}:${w.callIndex ?? ''}`}>
            {w.message}
          </Notice>
        ))}

      <Card testId="tms-review">
        <KeyValue rows={rows} testId="tms-review-fields" />
      </Card>

      {open && (
        <Card title="Your decision" testId="tms-act">
          {!canSign && <Notice tone="warn">{cannotSignReason}</Notice>}
          {canSign && !mine && <Notice tone="info">You are not a signer of this multisig.</Notice>}
          {review.requiresAcknowledgement && (
            <label className="tms-check">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} data-testid="tms-ack" />
              <span>I checked the warnings above, and the recipient, contract and calldata with the proposer through a separate channel.</span>
            </label>
          )}
          <div className="tms-actions">
            {canSign && mine && !mine.approved && (
              <Button kind="primary" disabled={needsAck || !!action.pending} onClick={() => act('Approving', () => client.approve(address, id), 'Approved')} testId="tms-approve">
                Approve
              </Button>
            )}
            {canSign && mine && !mine.approved && client.network.indexerUrl && (
              <Button disabled={needsAck || !!action.pending} onClick={() => act('Signing', () => client.signAndShare(address, id), 'Signed. The other signers will see your approval.')} testId="tms-sign">
                Approve without gas
              </Button>
            )}
            {canSign && mine?.approved && (
              <Button disabled={!!action.pending} onClick={() => act('Revoking', () => client.revoke(address, id), 'Approval revoked')} testId="tms-revoke">
                Revoke my approval
              </Button>
            )}
            {canSign && mine && (state === ProposalState.READY || enoughWithRelayed) && (
              <Button kind="primary" disabled={needsAck || review.blocked || !!action.pending} onClick={() => act('Executing', () => client.execute(address, id, view), 'Executed')} testId="tms-execute">
                Execute
              </Button>
            )}
            {canSign && isProposer && (
              <Button kind="danger" disabled={!!action.pending} onClick={() => act('Cancelling', () => client.cancel(address, id), 'Cancelled')} testId="tms-cancel">
                Cancel proposal
              </Button>
            )}
          </div>
          {state === ProposalState.QUEUED && <p className="tms-footnote">Approved. It can be executed from {formatTimestamp(details.proposal.executableAt)}.</p>}
          {review.blocked && state === ProposalState.READY && <Notice tone="warn">The multisig would refuse this as it stands (see the warnings above).</Notice>}
          {action.pending && <Spinner label={`${action.pending}… confirm in your wallet, then wait for the network`} />}
          <ErrorText error={action.error} />
          {done && !action.pending && <Notice tone="good" testId="tms-done">{done}</Notice>}
        </Card>
      )}
      {!open && done && <Notice tone="good" testId="tms-done">{done}</Notice>}
    </Screen>
  );
}
