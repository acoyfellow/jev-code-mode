# Security

Report vulnerabilities privately through GitHub security advisories on this repository.

Credentials are read from the environment. They are sent only to `JEV_GATEWAY_URL` and redacted from error text. `execute` runs model-written JavaScript in a worker VM with no network, filesystem, or process access. Treat it as defense-in-depth, not a hostile-code boundary.
