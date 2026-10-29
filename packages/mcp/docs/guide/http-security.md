# HTTP deployment and authorization

The default `stdio` transport runs locally with the caller's filesystem permissions. HTTP binds to `127.0.0.1` by default. Do not expose an unauthenticated HTTP listener to an untrusted network. Place remotely accessible HTTP behind TLS and an authenticated deployment boundary.

## Explicit JWT configuration

Setting `WCC_MCP_JWKS_URL` requires all three settings below. Missing or blank settings stop startup; they do not enable a permissive fallback.

| Setting | Operator-supplied value |
| --- | --- |
| `WCC_MCP_JWKS_URL` | Trusted authorization server's HTTPS JWKS endpoint. Loopback HTTP is suitable only for local tests. |
| `WCC_MCP_ISSUER` | Exact issuer of the access tokens accepted by this deployment. |
| `WCC_MCP_AUDIENCE` | Exact audience identifying this MCP resource. It is not inferred from a request Host header. |
| `WCC_MCP_REQUIRED_SCOPES` | Space-separated scopes that the authorization server must grant for this endpoint. All listed scopes are required. |
| `WCC_MCP_PUBLIC_URL` | External base URL used in resource metadata behind a trusted proxy. |
| `WCC_MCP_AUTHORIZATION_SERVERS` | Optional comma-separated authorization server metadata origins; defaults to the configured issuer. |

JWTs must have a valid signature, the configured issuer/audience, a future expiration, the required scopes and a subject or client identity. Render caches are separated by issuer, subject and client together: sharing an OAuth client does not grant access to another subject's render resources. Tokens and keys are never included in errors.

Alternatively, `WCC_MCP_AUTH_TOKENS` accepts operator-provisioned static bearer secrets. These are direct grants to the endpoint, not OAuth JWTs. Each configured token receives the configured required scopes (or `wcc:render` in static-only mode) and its own cache. Rotate/revoke them in deployment configuration; an environment secret is not a short-lived OAuth token.

## Protocol compatibility

This implementation uses SDK 1.32.2 and negotiates MCP **2025-11-25** (with older supported revisions). It does not claim conformance to MCP 2026-07-28: that revision changes discovery, initialization, per-request metadata and result shapes. A protocol migration needs explicit client/transport compatibility tests, not a change to a version label. The existing `initialize` handshake and seven tools are tested on stdio and Streamable HTTP.

Sources: [MCP authorization security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations), [MCP 2026-07-28 changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
