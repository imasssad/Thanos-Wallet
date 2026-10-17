import { useState } from 'react';
import { formatUnits } from 'ethers';
import { formatTokenUnits, type Address, type Call, type ReviewField, type TransactionReview } from '@litho-vault/sdk';
import { useMultisig } from '../context';
import { useAction, useAsync } from '../hooks';
import { AddressInput, Button, Card, ErrorText, Field, KeyValue, Notice, Screen, Spinner } from '../ui';

/** A new proposal that sends LITHO or a token from the multisig. Proposing records your approval. */
export function TransferScreen({ address, onBack }: { address: Address; onBack?: () => void }) {
  const { client, chainId, replace } = useMultisig();
  const balances = useAsync(() => client.balances(address), [client, address]);
  const [asset, setAsset] = useState(0);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState<{ calls: Call[]; review: TransactionReview; fields: ReviewField[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const action = useAction();

  if (balances.loading && !balances.data) return <Screen title="Send from MultiSig" onBack={onBack}><Spinner /></Screen>;
  const list = balances.data ?? [];
  const selected = list[asset];

  const toReview = async () => {
    setFormError(null);
    if (!selected) return;
    let calls: Call[];
    try {
      calls = client.transferCalls({ asset: selected.token, amount, recipient });
    } catch (e) {
      setFormError((e as Error).message);
      return;
    }
    const result = await action.run('Reviewing', () => client.reviewDraft(address, calls));
    if (result) {
      setAcknowledged(false);
      setDraft({ calls, ...result });
    }
  };

  if (draft) {
    const field = (key: string) => draft.fields.find((f) => f.key === key)?.value ?? '—';
    const needsAck = draft.review.requiresAcknowledgement && !acknowledged;
    return (
      <Screen title="Review the proposal" subtitle="The other signers will see exactly this before they approve" onBack={() => setDraft(null)}>
        {draft.review.warnings
          .filter((w) => w.level === 'danger')
          .map((w) => (
            <Notice tone="bad" key={w.code}>
              {w.message}
            </Notice>
          ))}
        <Card testId="tms-draft-review">
          <KeyValue
            rows={[
              { key: 'action', label: 'Action', value: draft.review.actionType },
              { key: 'asset', label: 'Asset', value: field('asset') },
              { key: 'amount', label: 'Amount', value: field('amount') },
              { key: 'recipient', label: 'Recipient', value: field('recipient') },
              { key: 'network', label: 'Network', value: `${client.network.chain.name} (chain ${chainId})` },
              { key: 'simulation', label: 'Simulation', value: draft.review.simulation.summary, tone: draft.review.simulation.status === 'success' ? 'good' : draft.review.simulation.status === 'failed' ? 'bad' : 'warn' },
              { key: 'required', label: 'Approvals needed', value: field('required') },
              { key: 'timing', label: 'Timelock', value: field('timing') },
              { key: 'warnings', label: 'Policy warnings', value: <span className="tms-pre">{field('warnings')}</span> },
              { key: 'fee', label: 'Fee to propose', value: draft.review.fees.propose?.formatted ?? '—' },
            ]}
          />
        </Card>
        {draft.review.requiresAcknowledgement && (
          <label className="tms-check">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>I understand the warnings above.</span>
          </label>
        )}
        <div className="tms-actions">
          <Button
            kind="primary"
            disabled={needsAck || draft.review.blocked || !!action.pending}
            onClick={async () => {
              const result = await action.run('Proposing', () => client.propose(address, draft.calls));
              if (result) replace({ name: 'proposal', address, id: result.id });
            }}
            testId="tms-propose"
          >
            Propose and approve
          </Button>
          <Button onClick={() => setDraft(null)}>Edit</Button>
        </div>
        {draft.review.blocked && <Notice tone="warn">The multisig would refuse this as it stands; see the warnings above.</Notice>}
        {action.pending && <Spinner label={`${action.pending}… confirm in your wallet, then wait for the network`} />}
        <ErrorText error={action.error} />
      </Screen>
    );
  }

  return (
    <Screen title="Send from MultiSig" subtitle="Creates a proposal; it is sent once enough signers approve" onBack={onBack}>
      <ErrorText error={balances.error} />
      <Card>
        <form
          className="tms-form"
          onSubmit={(e) => {
            e.preventDefault();
            void toReview();
          }}
        >
          <Field label="Asset">
            <select className="tms-input" value={asset} onChange={(e) => setAsset(Number(e.target.value))} data-testid="tms-asset">
              {list.map((b, i) => (
                <option key={b.token.address} value={i}>
                  {b.token.symbol} · {formatTokenUnits(b.amount, b.token.decimals)} available
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount" error={formError}>
            <span className="tms-input-row">
              <input className="tms-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" data-testid="tms-amount" />
              {selected && (
                <button type="button" className="tms-link-btn" onClick={() => setAmount(formatUnits(selected.amount, selected.token.decimals))}>
                  Max
                </button>
              )}
            </span>
          </Field>
          <Field label="Recipient">
            <AddressInput value={recipient} onChange={setRecipient} testId="tms-recipient" />
          </Field>
          <Button kind="primary" type="submit" disabled={!amount || !recipient || !!action.pending} testId="tms-review-btn">
            Review
          </Button>
        </form>
        {action.pending && <Spinner label="Decoding and simulating" />}
        <ErrorText error={action.error} />
      </Card>
    </Screen>
  );
}
