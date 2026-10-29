'use strict'
/*
 * Streamable HTTP transport (stateless: one server instance per request, JSON responses).
 *   POST /mcp                                  MCP endpoint
 *   GET  /.well-known/mcp/server-card.json     static server card (no auth, for registries/scanners)
 *   GET  /.well-known/oauth-protected-resource RFC 9728 metadata (when auth is configured)
 *   GET  /healthz
 * Auth (optional): WCC_MCP_AUTH_TOKENS (comma separated static bearer tokens) and/or OAuth JWTs
 * via WCC_MCP_JWKS_URL (requires WCC_MCP_ISSUER, WCC_MCP_AUDIENCE and
 * WCC_MCP_REQUIRED_SCOPES). Unauthenticated -> 401 with
 * WWW-Authenticate: Bearer resource_metadata="..." (RFC 9728), never 403.
 * Per-connection licence key: header x-wcc-license-key (Smithery x-from), else server env.
 */
const crypto = require('crypto')
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js')
const { InvalidTokenError } = require('@modelcontextprotocol/sdk/server/auth/errors.js')
const { createServer } = require('./server')
const { resolveConfig } = require('./config')
const { loadCore } = require('./core')
const { RenderCache } = require('./tools')
const { buildServerCard } = require('./card')

function authFromEnv(env = process.env) {
  const tokens = (env.WCC_MCP_AUTH_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const jwks = env.WCC_MCP_JWKS_URL || ''
  if (!tokens.length && !jwks) return null
  const issuer = (env.WCC_MCP_ISSUER || '').trim()
  const audience = (env.WCC_MCP_AUDIENCE || '').trim()
  const requiredScopes = (env.WCC_MCP_REQUIRED_SCOPES || '').split(/\s+/).filter(Boolean)
  if (jwks) {
    for (const [name, present] of [['WCC_MCP_ISSUER', issuer], ['WCC_MCP_AUDIENCE', audience], ['WCC_MCP_REQUIRED_SCOPES', requiredScopes.length]]) {
      if (!present) throw new Error(`${name} is required when WCC_MCP_JWKS_URL is configured`)
    }
  }
  return { tokens, jwks, issuer: issuer || undefined, audience: audience || undefined, requiredScopes: requiredScopes.length ? requiredScopes : ['wcc:render'], authorizationServers: (env.WCC_MCP_AUTHORIZATION_SERVERS || issuer).split(',').map((s) => s.trim()).filter(Boolean) }
}

function makeVerifier(auth) {
  const digests = auth.tokens.map((t) => crypto.createHash('sha256').update(t).digest())
  let jwksFn
  return {
    async verifyAccessToken(token) {
      const d = crypto.createHash('sha256').update(token).digest()
      const i = digests.findIndex((x) => crypto.timingSafeEqual(x, d))
      if (i >= 0) return { token, clientId: `static-${i}`, scopes: auth.requiredScopes, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
      if (auth.jwks) {
        const jose = await import('jose')
        jwksFn = jwksFn || jose.createRemoteJWKSet(new URL(auth.jwks))
        try {
          const { payload } = await jose.jwtVerify(token, jwksFn, { issuer: auth.issuer, audience: auth.audience, requiredClaims: ['iss', 'aud', 'exp'] })
          const subject = typeof payload.sub === 'string' && payload.sub ? payload.sub : null
          const client = typeof payload.client_id === 'string' && payload.client_id ? payload.client_id : typeof payload.azp === 'string' && payload.azp ? payload.azp : null
          if (!subject && !client) throw new InvalidTokenError('Token has no principal identity')
          // The OAuth client alone is not a tenant: two users can share the same app.
          const principal = crypto.createHash('sha256').update(JSON.stringify([payload.iss, subject, client])).digest('hex')
          return { token, clientId: `jwt-${principal}`, scopes: typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [], expiresAt: payload.exp, resource: auth.audience }
        } catch (e) {
          throw new InvalidTokenError('Invalid or expired token')
        }
      }
      throw new InvalidTokenError('Invalid token')
    }
  }
}

function createHttpApp({ env = process.env, core, host = '127.0.0.1', publicUrl, config } = {}) {
  const baseConfig = config || resolveConfig({ env })
  const sharedCore = core || loadCore()
  const auth = authFromEnv(env)
  const app = createMcpExpressApp({ host })
  app.disable('x-powered-by')
  const caches = new Map() // principal -> RenderCache, so tenants never see each other's renders
  let card

  const origin = (req) => publicUrl || env.WCC_MCP_PUBLIC_URL || `${req.protocol}://${req.get('host')}`
  const prmUrl = (req) => `${origin(req)}/.well-known/oauth-protected-resource/mcp`

  app.get('/healthz', (req, res) => res.json({ ok: true, core: sharedCore.unavailable ? `unavailable: ${sharedCore.unavailable}` : 'ok' }))

  app.get('/.well-known/mcp/server-card.json', async (req, res) => {
    try {
      card = card || (await buildServerCard({ authRequired: !!auth }))
      res.set('Cache-Control', 'public, max-age=300').json(card)
    } catch (e) {
      res.status(500).json({ error: 'server card unavailable' })
    }
  })

  const prm = (req, res) => {
    if (!auth) return res.status(404).json({ error: 'not_found', error_description: 'This server does not require authorization.' })
    res.json({
      resource: `${origin(req)}/mcp`,
      authorization_servers: auth.authorizationServers.length ? auth.authorizationServers : undefined,
      bearer_methods_supported: ['header'],
      scopes_supported: auth.requiredScopes,
      resource_name: 'West Coast Charts MCP',
      resource_documentation: 'https://westcoast-charts.com/agents//'
    })
  }
  app.get('/.well-known/oauth-protected-resource', prm)
  app.get('/.well-known/oauth-protected-resource/mcp', prm)

  const guards = []
  if (auth) {
    const verifier = makeVerifier(auth)
    guards.push((req, res, next) => requireBearerAuth({ verifier, requiredScopes: auth.requiredScopes, resourceMetadataUrl: prmUrl(req) })(req, res, next))
  }

  app.post('/mcp', ...guards, async (req, res) => {
    const principal = (req.auth && req.auth.clientId) || 'anonymous'
    if (!caches.has(principal)) {
      if (caches.size > 256) caches.delete(caches.keys().next().value)
      caches.set(principal, new RenderCache(32))
    }
    const headerKey = req.get('x-wcc-license-key')
    const cfg = headerKey ? { ...baseConfig, licenseKey: headerKey } : baseConfig
    const server = createServer({ config: cfg, core: sharedCore })
    server.wcc.renders = caches.get(principal)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      transport.close().catch(() => {})
      server.close().catch(() => {})
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  })

  const notAllowed = (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST /mcp.' }, id: null })
  app.get('/mcp', ...guards, notAllowed)
  app.delete('/mcp', ...guards, notAllowed)
  return app
}

function listen({ port = Number(process.env.PORT) || 8787, host = process.env.HOST || '127.0.0.1', ...rest } = {}) {
  const app = createHttpApp({ host, ...rest })
  return new Promise((ok) => {
    const s = app.listen(port, host, () => ok(s))
  })
}

module.exports = { createHttpApp, listen, authFromEnv, makeVerifier }
