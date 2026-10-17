import { formatTokenUnits, shortAccount } from '@litho-vault/sdk';
import { useMultisig } from '../context';
import { useAsync } from '../hooks';
import { Button, Card, ErrorText, Icon, Notice, Pill, Screen, Spinner } from '../ui';

export function HomeScreen({ onBack }: { onBack?: () => void }) {
  const { client, account, canSign, cannotSignReason, go } = useMultisig();
  const chain = client.network.chain;
  const list = useAsync(() => client.summaries(account), [client, account]);

  if (!client.available) {
    return (
      <Screen title="MultiSig" subtitle="Shared accounts that need several approvals to move funds" onBack={onBack}>
        <Notice tone="info" testId="tms-unavailable">
          Thanos MultiSig opens on {chain.name} as soon as the Litho Vault contracts are deployed there. Nothing to set up on your side: this
          screen will offer to create a multisig then.
        </Notice>
        <About />
      </Screen>
    );
  }

  return (
    <Screen
      title="MultiSig"
      subtitle={`Shared accounts on ${chain.name} that need several approvals to move funds`}
      onBack={onBack}
      actions={
        <button type="button" className="tms-icon-btn" onClick={list.reload} aria-label="Refresh" title="Refresh">
          <Icon name="refresh" />
        </button>
      }
    >
      <div className="tms-actions">
        <Button kind="primary" onClick={() => go({ name: 'create' })} disabled={!canSign} testId="tms-create">
          <Icon name="plus" size={16} /> Create MultiSig
        </Button>
        <Button onClick={() => go({ name: 'add' })} testId="tms-add">
          Add existing
        </Button>
      </div>
      {!canSign && cannotSignReason && <Notice tone="warn">{cannotSignReason}</Notice>}

      {list.loading && !list.data && <Spinner label="Finding your multisigs" />}
      <ErrorText error={list.error} />
      {list.data && list.data.length === 0 && (
        <Card>
          <div className="tms-empty" data-testid="tms-empty">
            <Icon name="users" size={28} />
            <p>No multisigs yet. Create one with the people who should approve payments, or add one you were made a signer of.</p>
          </div>
        </Card>
      )}
      {list.data && list.data.length > 0 && (
        <div className="tms-list" data-testid="tms-vault-list">
          {list.data.map((v) => (
            <button type="button" className="tms-row" key={v.address} onClick={() => go({ name: 'vault', address: v.address })} data-testid={`tms-vault-${v.address}`}>
              <span className="tms-avatar" aria-hidden="true">
                <Icon name="shield" size={18} />
              </span>
              <span className="tms-row-main">
                <span className="tms-row-title">{v.name}</span>
                <span className="tms-row-sub tms-mono">
                  {shortAccount(v.address, 6)} · {String(v.threshold)} of {v.signers.filter((s) => s.type === 1 || s.type === 2).length}
                </span>
                <span className="tms-pills">
                  {v.needsMyApproval > 0 && <Pill tone="info">Needs your approval · {v.needsMyApproval}</Pill>}
                  {v.readyToExecute > 0 && <Pill tone="good">Ready to execute · {v.readyToExecute}</Pill>}
                  {v.frozen && <Pill tone="bad">Frozen</Pill>}
                  {!v.isSigner && <Pill>View only</Pill>}
                </span>
              </span>
              <span className="tms-row-value">{formatTokenUnits(v.balance, 18, 'LITHO')}</span>
            </button>
          ))}
        </div>
      )}
      <About />
    </Screen>
  );
}

function About() {
  return (
    <p className="tms-footnote">
      Thanos MultiSig runs on Litho Vault, the LEP100-15 smart account: every payment is a proposal that the agreed number of signers must
      approve, and every signer sees the same decoded review before approving.
    </p>
  );
}
