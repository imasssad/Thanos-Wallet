import { useMemo, useState } from 'react';
import { displayAccount } from '@litho-vault/sdk';
import { cleanVaultName } from '../../store';
import { useMultisig } from '../context';
import { useAction } from '../hooks';
import { AddressInput, Button, Card, ErrorText, Field, Icon, Notice, Screen, Spinner } from '../ui';

/**
 * Create MultiSig, in the order of LEP100-15 §82: network, signers, threshold, optional AI
 * protection, recovery, deploy. The wallet's account is always the first signer.
 */
export function CreateScreen({ onBack }: { onBack?: () => void }) {
  const { client, chainId, account, replace, openUrl } = useMultisig();
  const [name, setName] = useState('');
  const [others, setOthers] = useState<string[]>(['']);
  const [threshold, setThreshold] = useState(2);
  const [predicted, setPredicted] = useState<string | null>(null);
  const action = useAction();

  const signerCount = 1 + others.filter((o) => o.trim()).length;
  const draft = useMemo(() => client.draftMultisig({ others, threshold: Math.min(threshold, signerCount) }), [client, others, threshold, signerCount]);
  const appUrl = client.network.appUrl;

  const deploy = async () => {
    const config = draft.config;
    const result = await action.run('Creating the multisig', async () => {
      setPredicted(await client.predictAddress(config));
      return client.create(config, cleanVaultName(name) || 'MultiSig');
    });
    if (result) replace({ name: 'vault', address: result.address });
  };

  return (
    <Screen title="Create MultiSig" subtitle="A shared account that moves funds only when enough of its signers approve" onBack={onBack}>
      <Card title="1. Network">
        <p className="tms-muted" data-testid="tms-create-network">
          {client.network.chain.name} (chain {chainId}). The multisig exists on this network only; send it funds only here.
        </p>
      </Card>

      <Card title="2. Name and signers">
        <div className="tms-form">
          <Field label="Name (only in your wallet)">
            <input className="tms-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Team treasury" data-testid="tms-name" />
          </Field>
          <Field label="Signer 1 (you)">
            <span className="tms-mono tms-static" data-testid="tms-me">{account ? displayAccount(account) : "—"}</span>
          </Field>
          {others.map((o, i) => (
            <Field key={i} label={`Signer ${i + 2}`}>
              <span className="tms-input-row">
                <AddressInput
                  value={o}
                  onChange={(v) => setOthers((list) => list.map((x, j) => (j === i ? v : x)))}
                  testId={`tms-signer-${i + 2}`}
                />
                {others.length > 1 && (
                  <button type="button" className="tms-link-btn" onClick={() => setOthers((list) => list.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </span>
            </Field>
          ))}
          {others.length < 19 && (
            <button type="button" className="tms-link-btn" onClick={() => setOthers((list) => [...list, ''])} data-testid="tms-add-signer">
              <Icon name="plus" size={14} /> Add signer
            </button>
          )}
        </div>
      </Card>

      <Card title="3. Approvals required">
        <Field label="How many signers must approve each payment" hint={threshold === 1 && signerCount > 1 ? 'With 1, any single signer can move funds alone.' : undefined}>
          <select className="tms-input" value={Math.min(threshold, signerCount)} onChange={(e) => setThreshold(Number(e.target.value))} data-testid="tms-threshold">
            {Array.from({ length: signerCount }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} of {signerCount}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="4. AI protection (optional)">
        <p className="tms-muted">
          Off. A signed AI risk assessment can later be required for risky payments, or used to ask for more approvals; it can never approve on
          its own.
          {appUrl && (
            <>
              {' '}
              <button type="button" className="tms-link-btn" onClick={() => openUrl(appUrl)}>
                Set it up in Litho Vault
              </button>
            </>
          )}
        </p>
      </Card>

      <Card title="5. Recovery (optional)">
        <p className="tms-muted">Off. Guardians who can replace a lost signer's key after a delay can be added later, through an approved proposal.</p>
      </Card>

      <Card title="6. Deploy">
        {draft.errors.length > 0 && (
          <Notice tone="warn" testId="tms-create-errors">
            {draft.errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </Notice>
        )}
        <p className="tms-muted">
          You pay the network fee to create it. Signers and the approval count can be changed later only with the approval of the current
          signers.
        </p>
        <div className="tms-actions">
          <Button kind="primary" disabled={draft.errors.length > 0 || !!action.pending || !account} onClick={() => void deploy()} testId="tms-deploy">
            Create MultiSig
          </Button>
        </div>
        {action.pending && <Spinner label={`${action.pending}… confirm in your wallet, then wait for the network`} />}
        {predicted && action.pending && <p className="tms-footnote tms-mono">Address: {predicted}</p>}
        <ErrorText error={action.error} />
      </Card>
    </Screen>
  );
}
