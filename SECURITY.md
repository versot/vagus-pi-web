# Security Policy

Vagus lets agents run code on your machine and install third-party plugins that
run with full system access. Security is a core design constraint — see
For security decisions please see the ADR index in the repository.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.** Report privately via
GitHub's Security Advisories ("Report a vulnerability" on the repository page),
or email the maintainers at <security@example.invalid> (replace with a real
address before first release).

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (minimal)
- Suggested fix, if you have one

We acknowledge reports within 72 hours and aim for a fix + advisory within 30
days.

## Security notes for users

- Only install plugins/adapters you trust; review the manifest and the package
  source before approving an install. Conversation-driven installs always ask
  for confirmation (M5).
- The permission engine defaults to `ask`; do not run at `full-access` unless
  you understand the blast radius.
- Credentials referenced via `${user.env.*}` are never stored by Vagus.
