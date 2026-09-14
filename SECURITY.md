# Security policy

OnePledge is a Midnight Buildathon project deployed only on **Midnight Preprod** (a test network). No real funds or real invoices are involved, and it has not been externally audited.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Include the affected file or contract, the steps to reproduce, and the impact. Please do not open a public issue for an unfixed vulnerability.

We aim to acknowledge reports within 3 days.

## Scope

- The Compact contract in `contract/src/` and its deployed Preprod instance listed in `deployments/preprod.json`.
- The attester, CLI and web packages in this repository.

Deprecated deployments in `deployments/archive/` are out of scope; they are kept only as a public record.

## Past findings

See [docs/security-review.md](docs/security-review.md) for the Wave 1 review, including a fixed critical issue in registry v1, and [docs/threat-model.md](docs/threat-model.md) for the assumptions the design relies on.
