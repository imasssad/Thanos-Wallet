import { useState } from 'react';
import { useMultisig } from '../context';
import { useAction } from '../hooks';
import { AddressInput, Button, Card, ErrorText, Field, Screen, Spinner } from '../ui';

/** Adds a multisig by address (one you were made a signer of later, or one you only follow). */
export function AddScreen({ onBack }: { onBack?: () => void }) {
  const { client, replace } = useMultisig();
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const action = useAction();
  return (
    <Screen title="Add existing MultiSig" subtitle={`Any Litho Vault multisig on ${client.network.chain.name}`} onBack={onBack}>
      <Card>
        <form
          className="tms-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const saved = await action.run('Checking', () => client.addExisting(address, name));
            if (saved) replace({ name: 'vault', address: saved.address });
          }}
        >
          <Field label="MultiSig address">
            <AddressInput value={address} onChange={setAddress} testId="tms-add-address" />
          </Field>
          <Field label="Name (only in your wallet)">
            <input className="tms-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Treasury" data-testid="tms-add-name" />
          </Field>
          <Button kind="primary" type="submit" disabled={!address.trim() || !!action.pending} testId="tms-add-submit">
            Add
          </Button>
        </form>
        {action.pending && <Spinner label="Checking the address" />}
        <ErrorText error={action.error} />
      </Card>
    </Screen>
  );
}
