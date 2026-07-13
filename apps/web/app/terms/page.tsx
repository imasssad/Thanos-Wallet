/**
 * /terms — Thanos Wallet Terms of Use.
 *
 * Content supplied by the client (KaJ Labs, 2026-07-13). Rendered from the
 * TERMS_SRC template below via a tiny deterministic formatter (no markdown
 * dependency): `## N. Title` → section heading, `- ` → list item, blank line
 * → block break, everything else → paragraph. Emails/URLs are linkified and
 * `[INSERT …]` placeholders are highlighted so unfilled legal blanks are
 * never mistaken for final text.
 *
 * NOTE: three legal blanks remain in the source (governing jurisdiction,
 * court location, arbitration institution/seat) and the operating-entity
 * naming (KaJ Labs vs the Byzantine DAO LLC registered address) needs the
 * client's confirmation before this is treated as final.
 */
import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

const EFFECTIVE_DATE = 'July 13, 2026';
const LAST_UPDATED   = 'July 13, 2026';

export const metadata: Metadata = {
  title:       'Terms of Use — Thanos Wallet',
  description: 'The terms governing your use of Thanos Wallet — a self-custodial, multi-chain crypto wallet by KaJ Labs.',
  openGraph: {
    title:       'Terms of Use — Thanos Wallet',
    description: 'Terms of Use for the self-custodial Thanos Wallet. Maintained by KaJ Labs.',
    url:         'https://thanos.fi/terms',
    siteName:    'Thanos Wallet',
    type:        'article',
  },
  alternates: { canonical: 'https://thanos.fi/terms' },
};

const wrapStyle: React.CSSProperties = {
  maxWidth:   760,
  margin:     '0 auto',
  padding:    '64px 24px 96px',
  fontFamily: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Arial, sans-serif',
  color:      '#e2e8f0',
  background: '#0b0d11',
  lineHeight: 1.65,
  fontSize:   15,
};
const h1:   React.CSSProperties = { fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 };
const h2:   React.CSSProperties = { fontSize: 19, fontWeight: 700, marginTop: 30, marginBottom: 8, scrollMarginTop: 24 };
const meta: React.CSSProperties = { color: '#94a3b8', fontSize: 13, marginBottom: 28 };
const hr:   React.CSSProperties = { border: 'none', borderTop: '1px solid #1f2937', margin: '32px 0' };
const linkStyle: React.CSSProperties = { color: '#7dd3fc', textDecoration: 'none' };
const pStyle: React.CSSProperties = { margin: '10px 0' };
const ulStyle: React.CSSProperties = { margin: '10px 0', paddingLeft: 22 };
const calloutStyle: React.CSSProperties = {
  borderLeft: '3px solid #38bdf8', background: 'rgba(56,189,248,0.06)',
  padding: '12px 16px', borderRadius: 8, margin: '12px 0 24px', color: '#cbd5e1',
};
const todoStyle: React.CSSProperties = {
  background: 'rgba(234,179,8,0.16)', color: '#fde68a', padding: '1px 6px',
  borderRadius: 4, fontWeight: 600, fontSize: 13,
};

/** Linkify emails, https URLs, and highlight [INSERT …] placeholders. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\[INSERT[^\]]*\])|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(<mark key={`${keyPrefix}-${i}`} style={todoStyle}>{m[1]}</mark>);
    } else if (m[2]) {
      parts.push(<a key={`${keyPrefix}-${i}`} style={linkStyle} href={`mailto:${m[2]}`}>{m[2]}</a>);
    } else if (m[3]) {
      parts.push(<a key={`${keyPrefix}-${i}`} style={linkStyle} href={m[3]} target="_blank" rel="noreferrer">{m[3]}</a>);
    }
    last = m.index + m[0].length; i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Parse the plain-text terms into headed sections of paragraphs + lists. */
function renderTerms(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let k = 0;
  const flushList = () => {
    if (!list.length) return;
    const items = list;
    out.push(
      <ul key={`ul-${k++}`} style={ulStyle}>
        {items.map((it, j) => <li key={j} style={{ margin: '4px 0' }}>{renderInline(it, `ul-${k}-${j}`)}</li>)}
      </ul>,
    );
    list = [];
  };
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    if (line.startsWith('## ')) {
      flushList();
      const title = line.slice(3);
      const idMatch = title.match(/^(\d+)\./);
      out.push(<h2 key={`h-${k++}`} id={idMatch ? `s${idMatch[1]}` : undefined} style={h2}>{title}</h2>);
    } else if (line.startsWith('- ')) {
      list.push(line.slice(2));
    } else {
      flushList();
      out.push(<p key={`p-${k++}`} style={pStyle}>{renderInline(line, `p-${k}`)}</p>);
    }
  }
  flushList();
  return out;
}

const TERMS_SRC = `
These Terms of Use ("Terms") govern your access to and use of the Thanos website, web application, browser extension, mobile applications, desktop applications, application programming interfaces, software, documentation and related products and services collectively known as "Thanos," "Thanos Wallet," the "Platform," or the "Services."
The Services are provided or maintained by KaJ Labs and its applicable affiliates ("KaJ Labs," "Thanos," "we," "us," or "our").
By accessing, downloading, installing or using the Services, you confirm that you have read, understood and agreed to these Terms. If you do not agree to these Terms, you must not access or use the Services.
These Terms contain important provisions concerning assumption of risk, disclaimers of warranties, limitations of liability, dispute resolution and your responsibility for safeguarding your wallet credentials.

## 1. Eligibility
You may use the Services only if:
- you are at least 18 years old and legally capable of entering into a binding agreement;
- your use of the Services is permitted under the laws of your country or jurisdiction;
- you are not located in, ordinarily resident in or organized under the laws of a jurisdiction where your use of the Services would be unlawful;
- you are not subject to sanctions or included on any list of prohibited or restricted persons maintained by the United Nations, United States, United Kingdom, European Union or any other applicable governmental authority; and
- you are not using the Services on behalf of a prohibited or restricted person.
If you use the Services for or on behalf of a company, organization or other legal entity, you represent that you have authority to bind that entity to these Terms. In that case, "you" includes both you and that entity.

## 2. Nature of the Services
Thanos is software that may enable users to:
- create, import and manage self-custodial blockchain wallets;
- generate and manage blockchain addresses;
- view digital-asset balances and transaction histories;
- send and receive digital assets;
- interact with supported blockchain networks;
- initiate token swaps;
- access cross-chain bridge functionality;
- connect to decentralized applications;
- interact with smart contracts;
- access staking or delegation interfaces;
- resolve or register decentralized names;
- view token, market and portfolio information; and
- access other blockchain-related functions made available from time to time.
Certain features may be provided through or depend upon third-party protocols, decentralized applications, blockchain networks, validators, bridges, liquidity providers, exchanges, aggregators, oracles, node operators, relayers and other independent services.
Thanos provides a software interface. Except where expressly stated otherwise, we do not operate, control or guarantee the underlying blockchain networks, smart contracts, decentralized protocols or third-party services with which you interact.

## 3. Self-Custodial Wallet
Thanos is designed as a self-custodial wallet. This means:
- you control the private keys associated with your wallet;
- we do not hold, custody or control your digital assets;
- we do not initiate blockchain transactions on your behalf;
- we cannot access, freeze, reverse, recover or transfer your digital assets;
- we cannot recover your wallet if you lose your recovery phrase, private key, password or other wallet credentials; and
- possession of your recovery phrase or private key may allow another person to control and permanently transfer your assets.
Your wallet credentials may be generated, encrypted and stored locally on your device. You are solely responsible for maintaining appropriate backups and securing your devices and credentials.
You acknowledge that no employee, representative or legitimate support agent of Thanos or KaJ Labs should ask you to disclose your complete recovery phrase or private key.

## 4. Recovery Phrase and Private-Key Security
You are solely responsible for:
- recording your recovery phrase accurately;
- maintaining one or more secure offline backups;
- keeping your recovery phrase and private keys confidential;
- protecting your wallet password and device credentials;
- preventing unauthorized physical or remote access to your devices;
- verifying the authenticity of Thanos applications, websites and software;
- protecting yourself against phishing, malware, social engineering, SIM swapping and fraudulent applications; and
- confirming all transaction details before approving or signing a transaction.
You must never share your recovery phrase or private key with any person unless you understand that doing so may provide complete control over your wallet.
We are not responsible for losses resulting from:
- loss or disclosure of a recovery phrase or private key;
- forgotten passwords;
- compromised devices;
- malicious browser extensions;
- malware or keyloggers;
- phishing websites;
- fraudulent applications;
- unauthorized wallet connections;
- compromised cloud backups;
- incorrectly recorded wallet credentials; or
- any other failure to secure your wallet or device.
Resetting, deleting or uninstalling the wallet may permanently remove locally stored wallet data. You should verify that you possess a correct recovery backup before resetting, deleting or uninstalling the wallet.

## 5. Optional Accounts and Cloud Features
Certain versions of Thanos may offer an optional account for syncing preferences, encrypted address-book information, device sessions, notifications or other non-custodial features.
Unless expressly stated otherwise:
- creating an account does not transfer custody of your digital assets to us;
- we do not receive or store your wallet recovery phrase or private keys;
- an account password is separate from your blockchain private keys;
- deleting an account does not erase transactions already recorded on a blockchain; and
- account recovery does not constitute wallet recovery.
You are responsible for protecting your account login information and notifying us promptly if you suspect unauthorized access.

## 6. Blockchain Transactions
Blockchain transactions may be irreversible.
Before submitting any transaction, you are responsible for confirming:
- the destination address;
- the blockchain network;
- the digital asset and token contract;
- the amount;
- applicable fees;
- slippage settings;
- bridge routes;
- smart-contract permissions;
- transaction data; and
- any warning displayed by the Platform.
A transaction sent to the wrong address, wrong network or incompatible contract may result in permanent loss.
Once a transaction is submitted to a blockchain network, we ordinarily cannot cancel, modify, reverse or recover it. Transaction status and completion depend on the relevant network and its participants.
A transaction displayed as "pending," "submitted," "processing," "confirmed," "failed," or similar language is informational only. Finality is determined by the applicable blockchain network, not by Thanos.

## 7. Network Fees and Other Charges
Blockchain transactions may require network, validator, gas, miner, protocol, liquidity-provider, relayer, bridge, routing, staking, withdrawal or other fees.
Unless expressly identified as a fee charged by Thanos, these fees are generally imposed by third parties or determined by network conditions.
You are responsible for reviewing and paying all applicable fees.
Displayed fee estimates may differ from the final fee because of:
- network congestion;
- gas-price changes;
- validator or miner conditions;
- transaction complexity;
- token-price movements;
- bridge conditions;
- routing changes; or
- third-party protocol rules.
We do not guarantee that any estimated fee, transaction time, exchange rate or output amount will remain available until your transaction is completed.

## 8. Token Swaps and Decentralized Exchanges
Thanos may allow you to request or initiate token swaps through decentralized exchanges, aggregators, liquidity pools or other third-party protocols.
When using swap functionality, you acknowledge that:
- Thanos may provide an interface to third-party smart contracts but may not be the counterparty to the transaction;
- prices may be determined by automated market makers, order books, liquidity providers or other market mechanisms;
- displayed quotes may change before execution;
- slippage, price impact and network fees may affect the amount received;
- low-liquidity or manipulated markets may produce unfavorable execution;
- tokens may be fraudulent, restricted, defective, illiquid or worthless;
- smart contracts may contain vulnerabilities;
- liquidity providers may withdraw liquidity;
- transactions may fail while still incurring network fees; and
- token approvals may grant a smart contract authority to transfer specified assets.
You are responsible for reviewing the applicable protocol, token contract, approval amount, route and transaction before signing.
The availability of a token, market, pair or protocol through Thanos does not constitute endorsement, verification, sponsorship or a recommendation.

## 9. Cross-Chain Bridges
Thanos may provide access to cross-chain bridge functionality, including interfaces that allow users to lock, burn, mint, wrap, unwrap or transfer representations of assets across different networks.
Bridge transactions involve additional risks, including:
- smart-contract vulnerabilities;
- validator, relayer or multisignature compromise;
- oracle failure;
- delayed message delivery;
- unsupported destination networks;
- insufficient liquidity;
- depegging of wrapped assets;
- chain reorganizations;
- transaction replay;
- protocol governance actions;
- emergency pauses;
- bridge insolvency;
- network forks; and
- permanent loss of assets.
Bridge completion times are estimates only. We do not guarantee that a bridge transaction will be completed, completed within a particular period or completed at an expected value.
You are responsible for confirming that the receiving network and wallet support the bridged asset.

## 10. Staking, Delegation and Rewards
Thanos may provide interfaces that allow users to stake, delegate, lock or otherwise commit digital assets to blockchain validators, staking contracts or third-party protocols.
Staking may involve:
- lock-up or unbonding periods;
- delayed withdrawals;
- validator commission;
- slashing;
- loss of rewards;
- loss of principal;
- smart-contract vulnerabilities;
- protocol changes;
- validator downtime;
- governance decisions;
- fluctuating reward rates; and
- tax consequences.
Displayed annual percentage rates, annual percentage yields, reward estimates or historical returns are estimates or informational data only. They are not guaranteed.
We do not guarantee the performance, security, conduct or continued operation of any validator, staking pool or protocol.
You are solely responsible for selecting validators and evaluating staking risks.

## 11. Decentralized Applications and Wallet Connections
Thanos may allow you to connect your wallet to decentralized applications through browser integrations, WalletConnect or similar connection methods.
When you connect to a decentralized application, the application may request permission to:
- view your public address;
- request transaction signatures;
- request message signatures;
- propose token approvals;
- interact with smart contracts;
- switch networks; or
- access session metadata.
You are responsible for reviewing every request before approving it.
Signing a message or transaction may have legal or financial consequences. A malicious signature request may authorize asset transfers, token approvals, listings, orders, permits or other actions.
Disconnecting a decentralized application may end an active session, but it may not revoke token approvals or permissions already granted on-chain. You may need to revoke those permissions separately.
Thanos does not control third-party decentralized applications and is not responsible for their code, content, security, availability, conduct or use of your information.

## 12. Digital Assets and Token Information
Thanos may display digital assets, token balances, logos, names, symbols, prices, charts, risk notices or related information.
The appearance of an asset in the Platform does not mean that we:
- created the asset;
- sponsor the asset;
- endorse the asset;
- verified its issuer;
- audited its smart contract;
- confirmed its legality;
- confirmed its liquidity;
- confirmed its market value; or
- recommend that you acquire, hold, sell or use it.
Token names and symbols may be duplicated or impersonated. You should verify the relevant token contract address and network independently.
Some assets may be:
- experimental;
- unregistered;
- fraudulent;
- subject to transfer restrictions;
- subject to administrative controls;
- capable of being frozen;
- capable of being minted without limit;
- illiquid;
- highly volatile; or
- legally restricted in your jurisdiction.
You assume all risk associated with selecting and interacting with digital assets.

## 13. Price and Market Data
Prices, charts, portfolio values, exchange rates and other market information may be supplied by third-party providers.
Such information may be delayed, incomplete, inaccurate or unavailable.
Displayed fiat values are estimates and may not represent:
- an executable market price;
- the amount you could receive in a sale;
- the acquisition cost of an asset;
- the tax value of an asset; or
- the price available on another platform.
You should not rely solely on information displayed through Thanos when making financial, tax, legal or trading decisions.

## 14. No Financial, Investment, Legal or Tax Advice
Nothing available through the Services constitutes:
- investment advice;
- financial advice;
- trading advice;
- legal advice;
- accounting advice;
- tax advice;
- brokerage services;
- investment management;
- portfolio management;
- a recommendation;
- an offer to sell; or
- a solicitation to purchase any security, commodity, financial instrument or digital asset.
You are solely responsible for determining whether any transaction or use of the Services is appropriate for you.
You should consult qualified professional advisers regarding your personal circumstances.

## 15. Digital-Asset Risks
Digital assets and blockchain systems involve substantial risk. You acknowledge and accept that:
- digital-asset prices may be extremely volatile;
- you may lose some or all of your assets;
- transactions may be irreversible;
- blockchain protocols may be modified or discontinued;
- networks may experience congestion, forks, attacks or outages;
- smart contracts may contain bugs or vulnerabilities;
- private keys may be stolen or lost;
- tokens may lose their utility or value;
- stablecoins may lose their peg;
- wrapped assets may become unredeemable;
- bridges or protocols may be exploited;
- regulatory treatment may change;
- governments may restrict, prohibit or tax digital-asset activity;
- third parties may provide inaccurate or fraudulent information;
- software updates may introduce defects or incompatibilities;
- hardware or operating-system failures may cause data loss;
- transaction costs may increase unexpectedly; and
- apparent rewards or yields may not compensate for the risks involved.
You should not use the Services with assets that you cannot afford to lose.

## 16. Beta, Testnet and Experimental Features
Some Services may be described as alpha, beta, preview, experimental, testnet, developer preview or similar terminology.
Experimental features may:
- contain errors;
- be incomplete;
- be unavailable;
- produce unexpected results;
- be changed without notice;
- be discontinued;
- use assets with no market value; or
- result in loss of test or real assets.
You use experimental features entirely at your own risk.
Testnet assets ordinarily have no monetary value. We are not responsible for any representation that a testnet asset is redeemable, transferable or valuable.

## 17. Open-Source Software
Parts of Thanos may be released under open-source software licences.
Your use of open-source components is also governed by the applicable licence terms. If there is a conflict between these Terms and an applicable open-source licence concerning the relevant source code, the open-source licence will govern that code to the extent of the conflict.
Open-source availability does not constitute a warranty that the software is secure, error-free or appropriate for any particular use.

## 18. Software Licence
Subject to your compliance with these Terms, we grant you a limited, personal, revocable, non-exclusive, non-transferable and non-sublicensable licence to access and use the Services for lawful purposes.
This licence does not permit you to:
- sell, rent, lease or commercially sublicense the Services;
- use our trademarks without authorization;
- bypass security controls;
- interfere with the operation of the Services;
- access non-public systems without permission;
- introduce malicious code;
- use the Services to attack a blockchain, validator, protocol or user;
- misrepresent your affiliation with Thanos or KaJ Labs; or
- use proprietary portions of the Services in violation of applicable intellectual-property laws.
Nothing in these Terms transfers ownership of the Services, branding or proprietary technology to you.

## 19. Acceptable Use
You must not use the Services to:
- violate any law, regulation, court order or governmental restriction;
- engage in fraud, theft, deception or misrepresentation;
- launder money or finance terrorism;
- evade sanctions or export controls;
- transact with stolen or unlawfully obtained assets;
- distribute malware, ransomware or malicious smart contracts;
- impersonate another person or entity;
- interfere with or disrupt the Services;
- exploit vulnerabilities without authorization;
- manipulate markets or engage in unlawful trading activity;
- infringe intellectual-property, privacy or other rights;
- harass, threaten or harm another person;
- facilitate the sale of illegal goods or services;
- gain unauthorized access to wallets, accounts, systems or data;
- scrape, overload or abuse infrastructure in a manner that impairs the Services;
- mislead users into disclosing private keys or recovery phrases; or
- use the Services in any manner that could expose us or another person to legal or regulatory liability.
We may restrict access to hosted interfaces or related services when we reasonably believe such action is necessary to protect users, comply with law, respond to security threats or preserve the integrity of the Services.
Because Thanos is self-custodial software, restricting access to a hosted interface may not prevent a user from accessing assets through other compatible software.

## 20. Sanctions and Restricted Jurisdictions
You represent that you are not:
- the subject of economic or trade sanctions;
- owned or controlled by a sanctioned person;
- acting on behalf of a sanctioned person; or
- using the Services from a comprehensively sanctioned or prohibited jurisdiction where such use would violate applicable law.
You must not use the Services to directly or indirectly benefit a prohibited person or evade applicable sanctions.
We may use reasonable technical measures to restrict access to hosted Services where required by law. Such restrictions do not mean that we have custody or control of your digital assets.

## 21. Compliance and Taxes
You are solely responsible for:
- determining whether your use of the Services is legal;
- obtaining any necessary licences or approvals;
- maintaining appropriate transaction records;
- calculating and reporting taxes;
- paying applicable taxes, duties and assessments; and
- complying with reporting, registration and disclosure obligations.
We do not determine your tax liability and do not provide tax documentation unless expressly required by applicable law.
Public blockchain records may be visible to governmental authorities, analytics providers and other third parties.

## 22. Third-Party Services
The Services may rely upon or link to third-party products and services, including:
- blockchain networks;
- remote procedure call providers;
- block explorers;
- price-data providers;
- decentralized exchanges;
- swap aggregators;
- bridges;
- staking protocols;
- validators;
- node operators;
- decentralized naming services;
- WalletConnect infrastructure;
- push-notification providers;
- cloud infrastructure;
- application stores;
- websites and decentralized applications.
Third-party services are governed by their own terms and privacy practices.
We do not control and are not responsible for:
- third-party availability;
- third-party security;
- protocol governance;
- smart-contract code;
- transaction execution;
- liquidity;
- prices;
- representations made by third parties;
- third-party fees;
- third-party data handling; or
- losses caused by third-party services.
Your use of third-party services is at your own risk.

## 23. App Stores and Device Platforms
If you download Thanos through an app store or device platform, your use may also be governed by the store's or platform's terms.
The relevant app-store provider:
- is not a party to these Terms;
- is not responsible for providing support;
- is not responsible for claims relating to the Services, except as required by law; and
- may be a third-party beneficiary of provisions applicable to the distributed application.
You are responsible for using compatible devices, operating systems and software versions.

## 24. Updates, Modifications and Availability
We may update, modify, suspend or discontinue any part of the Services at any time.
Updates may be necessary to:
- address security vulnerabilities;
- support protocol upgrades;
- add or remove networks;
- improve performance;
- comply with law;
- remove unsupported integrations; or
- address technical risks.
We do not guarantee that:
- every network or asset will remain supported;
- the Services will be available at all times;
- an older application version will remain functional;
- a third-party integration will continue operating; or
- data displayed by the Services will always be current.
You are responsible for installing security updates promptly.
Where reasonably possible, we may provide notice of material changes, but emergency security changes may be implemented without advance notice.

## 25. Security Incidents and Vulnerability Disclosure
No software or blockchain system is completely secure.
If you discover a potential vulnerability in Thanos, you must not exploit it, access data without authorization or publicly disclose it in a manner that creates avoidable risk to users.
Security reports should be sent to: security@thanos.fi
Please include sufficient information to reproduce and evaluate the issue.
We may maintain a separate responsible-disclosure or bug-bounty policy. Any reward is discretionary unless governed by separate written terms.

## 26. Intellectual Property
Except for open-source components and third-party materials, the Services and their associated software, interfaces, visual designs, text, graphics, logos, trademarks, documentation, databases and proprietary technology are owned by or licensed to KaJ Labs and are protected by applicable intellectual-property laws.
"Thanos," "Thanos Wallet," associated logos and related branding may not be used without our prior written permission.
Nothing in these Terms grants you a right to use the name, trademarks or branding of KaJ Labs, Lithosphere, Thanos or any affiliate except as necessary to identify the Services accurately.

## 27. Feedback
If you provide suggestions, ideas, comments or other feedback concerning the Services, you grant us a worldwide, perpetual, irrevocable, transferable, sublicensable and royalty-free right to use, reproduce, modify, commercialize and incorporate that feedback without compensation or restriction.
You represent that you have the right to provide the feedback.

## 28. Privacy
Our collection and handling of personal information are described in the Thanos Privacy Policy.
The Privacy Policy forms part of these Terms and is available through the Thanos website or application.
Blockchain transactions are public by design. Information recorded on a public blockchain may be permanent and cannot ordinarily be altered or deleted by us.

## 29. Electronic Communications
You agree to receive communications electronically, including through:
- the Platform;
- email;
- application notifications;
- push notifications;
- website notices; or
- other electronic methods.
Electronic notices satisfy any legal requirement that communications be provided in writing, to the extent permitted by law.
You are responsible for maintaining accurate contact information for any optional account.

## 30. Disclaimers
TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICES ARE PROVIDED ON AN "AS IS," "AS AVAILABLE" AND "WITH ALL FAULTS" BASIS.
WE DISCLAIM ALL EXPRESS, IMPLIED AND STATUTORY WARRANTIES, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, AVAILABILITY, SECURITY, RELIABILITY, QUIET ENJOYMENT, AND FREEDOM FROM VIRUSES OR HARMFUL CODE.
WE DO NOT WARRANT THAT:
- THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE OR SECURE;
- DEFECTS WILL BE CORRECTED;
- TRANSACTIONS WILL BE COMPLETED;
- ANY BLOCKCHAIN OR PROTOCOL WILL REMAIN AVAILABLE;
- ANY ASSET WILL RETAIN VALUE;
- ANY PRICE, QUOTE, BALANCE OR DATA WILL BE ACCURATE;
- ANY THIRD-PARTY SERVICE WILL PERFORM AS EXPECTED;
- THE SERVICES WILL MEET YOUR REQUIREMENTS; OR
- DIGITAL ASSETS WILL BE RECOVERABLE AFTER LOSS, THEFT OR AN ERRONEOUS TRANSACTION.
Some jurisdictions do not permit certain warranty exclusions. In those jurisdictions, the exclusions apply only to the maximum extent permitted by law.

## 31. Assumption of Risk
You expressly acknowledge and assume all risks arising from or relating to self-custody, blockchain technology, digital assets, smart contracts, wallet connections, decentralized applications, token approvals, swaps, staking, bridges, testnets, software defects, device compromise, third-party services, regulatory changes and market volatility.
You are solely responsible for evaluating these risks before using the Services.

## 32. Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, KAJ LABS, THANOS AND THEIR AFFILIATES, FOUNDERS, DIRECTORS, OFFICERS, EMPLOYEES, CONTRACTORS, DEVELOPERS, LICENSORS AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES; LOSS OF PROFITS, REVENUE, BUSINESS, GOODWILL OR DATA; LOSS OF DIGITAL ASSETS OR PRIVATE KEYS; LOSS CAUSED BY UNAUTHORIZED TRANSACTIONS; LOSS ARISING FROM SMART-CONTRACT FAILURE; LOSS ARISING FROM A BRIDGE OR PROTOCOL EXPLOIT; LOSS ARISING FROM MARKET MOVEMENTS; OR LOSS ARISING FROM INTERRUPTION OR UNAVAILABILITY OF THE SERVICES.
THIS LIMITATION APPLIES REGARDLESS OF THE THEORY OF LIABILITY, INCLUDING CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY OR OTHERWISE, AND EVEN IF WE WERE ADVISED OF THE POSSIBILITY OF THE LOSS.
TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE SERVICES OR THESE TERMS WILL NOT EXCEED THE GREATER OF: (a) THE AMOUNT YOU DIRECTLY PAID TO US FOR THE SERVICES DURING THE 12 MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM; OR (b) USD $100.
NETWORK FEES, GAS FEES AND AMOUNTS PAID TO THIRD-PARTY PROTOCOLS ARE NOT AMOUNTS PAID TO US.
Nothing in these Terms excludes liability that cannot legally be excluded, including liability for fraud, fraudulent misrepresentation, willful misconduct or any other liability that applicable law does not permit us to limit.

## 33. Indemnification
To the maximum extent permitted by law, you agree to defend, indemnify and hold harmless KaJ Labs, Thanos, their affiliates and their respective directors, officers, employees, contractors, developers, licensors and service providers from claims, liabilities, damages, losses, penalties, costs and expenses, including reasonable legal fees, arising from or relating to:
- your use or misuse of the Services;
- your breach of these Terms;
- your violation of law;
- your infringement of another person's rights;
- transactions initiated through your wallet;
- assets or content you make available through the Services;
- your interaction with a third-party protocol; or
- another person's use of the Services through your device, account or wallet credentials.
We may assume exclusive control of the defence of any indemnified matter. You agree to cooperate with that defence.

## 34. Suspension and Termination
You may stop using the Services at any time.
We may suspend, restrict or terminate your access to hosted or centrally operated portions of the Services if:
- you violate these Terms;
- we reasonably suspect unlawful or fraudulent activity;
- continued access creates a security risk;
- we are required to do so by law;
- a third-party provider discontinues a necessary service;
- the Services are discontinued; or
- suspension is reasonably necessary to protect users or infrastructure.
Termination of access to a hosted interface does not transfer control of your self-custodial wallet or assets to us.
Before deleting or uninstalling the wallet, you are responsible for backing up your recovery phrase and ensuring that you can access your wallet through compatible software.
Provisions that by their nature should survive termination will survive, including provisions concerning intellectual property, risk, disclaimers, liability, indemnification and disputes.

## 35. Changes to These Terms
We may update these Terms from time to time.
When we make changes, we will update the "Last Updated" date. For material changes, we may provide additional notice through the website, application or email.
Unless otherwise stated, updated Terms become effective when posted.
Your continued use of the Services after updated Terms take effect constitutes acceptance of the revised Terms.
If you do not agree with an update, you must stop using the Services.

## 36. Governing Law
These Terms and any dispute arising from or relating to them will be governed by the laws of [INSERT GOVERNING JURISDICTION], without regard to conflict-of-law rules.
Mandatory consumer-protection laws in your country of residence may continue to apply where they cannot legally be excluded.

## 37. Dispute Resolution
Before commencing formal proceedings, you agree to contact us and attempt in good faith to resolve the dispute informally.
A notice of dispute must include:
- your name;
- your contact information;
- the wallet address or account relevant to the dispute, where appropriate;
- a description of the dispute;
- the relief requested; and
- supporting information.
Notices of dispute should be sent to: legal@thanos.fi
If the dispute is not resolved within 30 days after receipt of a complete notice, either party may commence proceedings before the courts of [INSERT EXCLUSIVE COURT LOCATION], unless applicable law requires another forum.
Optional Arbitration Provision. Where approved by legal counsel, the following may replace the court provision: Any dispute that cannot be resolved informally will be finally resolved by binding arbitration administered by [INSERT ARBITRATION INSTITUTION] under its applicable rules. The seat of arbitration will be [INSERT CITY AND COUNTRY]. The arbitration will be conducted in English by one arbitrator.

## 38. Consumer Rights
Nothing in these Terms limits any consumer right that cannot lawfully be waived or excluded.
Depending on where you live, you may have additional rights concerning digital services, software, privacy, warranties or dispute resolution.

## 39. Force Majeure
We will not be responsible for delay, interruption or failure caused by events beyond our reasonable control, including natural disasters, war, terrorism, civil unrest, government action, sanctions, power failures, internet outages, cloud-service failures, cyberattacks, blockchain congestion, protocol failures, validator failures, network forks, telecommunications failures, labour disputes, or failures of third-party infrastructure.

## 40. Assignment
You may not assign or transfer these Terms without our prior written consent.
We may assign or transfer these Terms to an affiliate or in connection with a merger, restructuring, financing, acquisition, sale of assets or transfer of the Services.

## 41. No Partnership or Fiduciary Relationship
These Terms do not create a partnership, joint venture, agency, employment, brokerage, trust, advisory or fiduciary relationship between you and us.
We do not act as your agent, trustee, broker, financial adviser or custodian.

## 42. No Waiver
A failure or delay in enforcing any provision of these Terms does not waive that provision or any other right.
Any waiver must be in writing and signed by an authorized representative.

## 43. Severability
If any provision of these Terms is found unlawful, invalid or unenforceable, that provision will be enforced to the maximum extent permitted and the remaining provisions will remain in effect.

## 44. Entire Agreement
These Terms, the Privacy Policy and any additional terms expressly applicable to a particular feature constitute the entire agreement between you and us concerning the Services.
They replace prior or contemporaneous understandings concerning the same subject matter.

## 45. Order of Precedence
If there is a conflict between these Terms and feature-specific terms, the feature-specific terms will govern solely with respect to that feature.
Open-source licence terms govern applicable open-source code to the extent required by those licences.

## 46. Language
These Terms may be translated for convenience. The English-language version will control to the extent permitted by law if a translated version conflicts with it.

## 47. Contact Information
Questions concerning these Terms may be directed to:
- Thanos Wallet by KaJ Labs
- Website: https://thanos.fi
- Documentation: https://docs.thanos.fi
- Legal: legal@thanos.fi
- Support: support@thanos.fi
- Security: security@thanos.fi
- Registered Address: Byzantine DAO LLC, 30 N Gould St Ste R, Sheridan, WY 82801

## 48. Important Self-Custody Notice
THANOS IS A SELF-CUSTODIAL WALLET.
WE DO NOT HAVE ACCESS TO YOUR RECOVERY PHRASE OR PRIVATE KEYS.
WE CANNOT RECOVER LOST CREDENTIALS, REVERSE BLOCKCHAIN TRANSACTIONS OR RESTORE ASSETS SENT TO AN INCORRECT ADDRESS OR NETWORK.
KEEP YOUR RECOVERY PHRASE PRIVATE, SECURE AND BACKED UP OFFLINE.
`;

export default function TermsPage() {
  return (
    <main style={{ background: '#0b0d11', minHeight: '100vh' }}>
      <article style={wrapStyle}>
        <h1 style={h1}>Terms of Use</h1>
        <p style={meta}>
          <strong>Effective date:</strong> {EFFECTIVE_DATE} &nbsp;·&nbsp;{' '}
          <strong>Last updated:</strong> {LAST_UPDATED} &nbsp;·&nbsp; Maintained by KaJ Labs
        </p>

        <div style={calloutStyle}>
          Thanos is a self-custodial wallet: we never hold your keys and cannot reverse a
          transaction or recover lost credentials. Please read Sections 3, 4, 30, 31 and 32 —
          they cover self-custody, risk, disclaimers and the limits of our liability.
        </div>

        {renderTerms(TERMS_SRC)}

        <hr style={hr}/>
        <p style={{ fontSize: 14, color: '#cbd5e1', fontStyle: 'italic' }}>
          Thanos Wallet is self-custodial. Your keys, your crypto.
        </p>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 24 }}>
          <Link href="/privacy" style={linkStyle}>Privacy Policy</Link>
          {' · '}
          <Link href="/" style={linkStyle}>← Back to thanos.fi</Link>
        </p>
      </article>
    </main>
  );
}
