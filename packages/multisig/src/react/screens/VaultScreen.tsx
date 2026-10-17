import { useState } from 'react';
import { PROPOSAL_STATE_LABEL, ProposalState, SIGNER_TYPE_LABEL, SignerType, formatTokenUnits, isHumanSigner, type Address } from '@litho-vault/sdk';
import type { ProposalLine } from '../../client';
import { cleanVaultName } from '../../store';
import { useMultisig } from '../context';
import { useAsync } from '../hooks';
import { AddressText, Button, Card, ErrorText, Icon, Notice, Pill, Screen, Spinner, type Tone } from '../ui';

export function stateTone(state: ProposalState): Tone {
  switch (state) {
    case ProposalState.READY:
    case ProposalState.EXECUTED:
      return 'good';
    case ProposalState.PENDING:
    case ProposalState.QUEUED:
      return 'info';
    case ProposalState.CANCELLED:
      return 'neutral';
    default:
      return 'bad';
  }
}

export function VaultScreen({ address, onBack }: { address: Address; onBack?: () => void }) {
  const { client, account, canSign, go, back, openUrl, explorerAddress } = useMultisig();
  const data = useAsync(async () => {
    const [snapshot, balances, proposals, name] = await Promise.all([client.snapshot(address), client.balances(address), client.proposalLines(address), client.nameOf(address)]);
    return { snapshot, balances, proposals, name };
  }, [client, address]);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (data.loading && !data.data) return <Screen title="MultiSig" onBack={onBack}><Spinner label="Reading the multisig" /></Screen>;
  if (!data.data) return <Screen title="MultiSig" onBack={onBack}><ErrorText error={data.error} /></Screen>;
  const { snapshot, balances, proposals, name } = data.data;
  const humans = snapshot.signers.filter((s) => isHumanSigner(s.type));
  const me = account?.toLowerCase();
  const isSigner = !!me && humans.some((s) => s.address.toLowerCase() === me);
  const explorer = explorerAddress(address);

  return (
    <Screen
      title={
        renaming === null ? (
          <span className="tms-title-row">
            <span data-testid="tms-vault-name">{name}</span>
            <button type="button" className="tms-link-btn" onClick={() => setRenaming(name)}>
              Rename
            </button>
          </span>
        ) : (
          <form
            className="tms-title-row"
            onSubmit={async (e) => {
              e.preventDefault();
              await client.saved.add(address, renaming);
              setRenaming(null);
              data.reload();
            }}
          >
            <input className="tms-input" value={renaming} maxLength={40} onChange={(e) => setRenaming(e.target.value)} aria-label="Name" autoFocus />
            <Button type="submit" disabled={!cleanVaultName(renaming)}>
              Save
            </Button>
          </form>
        )
      }
      subtitle={<AddressText address={address} full testId="tms-vault-address" />}
      onBack={onBack}
      actions={
        <button type="button" className="tms-icon-btn" onClick={data.reload} aria-label="Refresh" title="Refresh">
          <Icon name="refresh" />
        </button>
      }
    >
      {snapshot.freeze.frozen && <Notice tone="bad">This multisig is frozen: nothing can leave it until the freeze ends or the signers lift it.</Notice>}
      {!isSigner && <Notice tone="info">You are not a signer of this multisig, so you can follow it but not approve.</Notice>}

      <Card
        title="Balance"
        aside={
          isSigner && canSign ? (
            <Button kind="primary" onClick={() => go({ name: 'transfer', address })} testId="tms-new-transfer">
              <Icon name="send" size={16} /> Send
            </Button>
          ) : null
        }
        testId="tms-balances"
      >
        {balances.map((b) => (
          <div className="tms-balance" key={b.token.address}>
            <span>{b.token.symbol}</span>
            <strong>{formatTokenUnits(b.amount, b.token.decimals)}</strong>
          </div>
        ))}
        <p className="tms-footnote">To fund it, send to the address above on {client.network.chain.name} only.</p>
      </Card>

      <Card title="Proposals" testId="tms-proposals">
        {proposals.open.length === 0 && <p className="tms-muted">Nothing waiting for approval.</p>}
        <ProposalList lines={proposals.open} onOpen={(id) => go({ name: 'proposal', address, id })} />
        {proposals.closed.length > 0 && (
          <>
            <h3 className="tms-subhead">Recent</h3>
            <ProposalList lines={proposals.closed} onOpen={(id) => go({ name: 'proposal', address, id })} />
          </>
        )}
      </Card>

      <Card title={`Signers · ${String(snapshot.threshold)} of ${humans.length} must approve`} testId="tms-signers">
        <ul className="tms-signers">
          {snapshot.signers
            .filter((s) => s.type !== SignerType.RECOVERY)
            .map((s) => (
              <li key={s.address}>
                <AddressText address={s.address} />
                <span className="tms-pills">
                  {s.address.toLowerCase() === me && <Pill tone="info">You</Pill>}
                  {s.type !== SignerType.KEY && <Pill>{SIGNER_TYPE_LABEL[s.type]}</Pill>}
                </span>
              </li>
            ))}
        </ul>
        {snapshot.minHumanApprovals > 1n && <p className="tms-footnote">At least {String(snapshot.minHumanApprovals)} approvals must come from people.</p>}
      </Card>

      <div className="tms-actions">
        {client.network.appUrl && (
          <Button onClick={() => openUrl(`${client.network.appUrl}/#/v/${address}`)}>
            <Icon name="link" size={16} /> Policies, recovery and more in Litho Vault
          </Button>
        )}
        {explorer && (
          <Button onClick={() => openUrl(explorer)}>
            <Icon name="link" size={16} /> Explorer
          </Button>
        )}
        <Button
          kind="danger"
          onClick={async () => {
            await client.saved.remove(address);
            back();
          }}
          testId="tms-remove"
        >
          Remove from list
        </Button>
      </div>
    </Screen>
  );
}

function ProposalList({ lines, onOpen }: { lines: ProposalLine[]; onOpen: (id: bigint) => void }) {
  return (
    <div className="tms-list">
      {lines.map((p) => (
        <button type="button" className="tms-row" key={String(p.id)} onClick={() => onOpen(p.id)} data-testid={`tms-proposal-${p.id}`}>
          <span className="tms-row-main">
            <span className="tms-row-title">
              #{String(p.id)} · {p.summary}
            </span>
            <span className="tms-pills">
              <Pill tone={stateTone(p.state)}>{PROPOSAL_STATE_LABEL[p.state]}</Pill>
              {p.myApproval === false && (p.state === ProposalState.PENDING || p.state === ProposalState.QUEUED || p.state === ProposalState.READY) && <Pill tone="info">Your approval needed</Pill>}
            </span>
          </span>
          <span className="tms-row-value">
            {p.approvals}/{p.required}
          </span>
        </button>
      ))}
    </div>
  );
}
