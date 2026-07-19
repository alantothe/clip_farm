import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Instagram,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'

function formatDate(value: string | null): string {
  if (!value) return 'Managed by Meta'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

const connectionErrors: Record<string, string> = {
  authorization_denied: 'Instagram authorization was cancelled.',
  invalid_state: 'The login session expired. Start the connection again.',
  missing_code: 'Instagram did not return a login code.',
  connection_failed: 'Instagram could not be connected. Check the Meta app configuration and try again.',
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const query = useQuery({
    queryKey: ['platform-connections'],
    queryFn: api.listPlatformConnections,
  })
  const disconnect = useMutation({
    mutationFn: api.disconnectInstagram,
    onSuccess: async () => {
      setConfirmDisconnect(false)
      setSearchParams({}, { replace: true })
      await queryClient.invalidateQueries({ queryKey: ['platform-connections'] })
    },
  })
  const instagram = query.data?.find((item) => item.platform === 'instagram')
  const account = instagram?.account
  const connected = account?.status === 'connected'
  const callbackStatus = searchParams.get('instagram')
  const callbackReason = searchParams.get('reason') ?? ''

  return (
    <main className="settings-page">
      <section className="settings-intro" aria-labelledby="settings-title">
        <div>
          <p className="eyebrow">Settings · Connected apps</p>
          <h1 id="settings-title">Your publishing<br />connections.</h1>
        </div>
        <p>
          Connect the accounts Clip Farm can publish to. Passwords stay with the platform;
          only encrypted authorization tokens are stored here.
        </p>
      </section>

      {callbackStatus === 'connected' && (
        <div className="connection-notice connection-notice--success" role="status">
          <Check size={17} /> Instagram connected. Clip Farm is ready for the publishing step.
        </div>
      )}
      {callbackStatus === 'error' && (
        <div className="connection-notice connection-notice--error" role="alert">
          <AlertTriangle size={17} />
          {connectionErrors[callbackReason] ?? 'Instagram could not be connected.'}
        </div>
      )}

      <section className="connections-panel" aria-labelledby="connections-heading">
        <div className="connections-panel__head">
          <div>
            <span>Connection bay</span>
            <h2 id="connections-heading">Connected apps</h2>
          </div>
          <div className="connections-count">
            <strong>{connected ? '01' : '00'}</strong>
            <span>active</span>
          </div>
        </div>

        {query.isLoading ? (
          <div className="connections-loading"><LoaderCircle className="spin" /> Checking connections…</div>
        ) : query.error ? (
          <div className="connections-loading connections-loading--error" role="alert">
            <AlertTriangle /> {query.error.message}
          </div>
        ) : (
          <article className={`connected-app ${connected ? 'is-connected' : ''}`}>
            <div className="connected-app__index" aria-hidden="true"><span>01</span><i /></div>
            <div className="connected-app__identity">
              <span className="instagram-mark"><Instagram size={29} /></span>
              <div>
                <span className="connected-app__provider">Meta platform</span>
                <h3>Instagram</h3>
                <p>Business and Creator accounts</p>
              </div>
            </div>

            <div className="connected-app__state">
              {connected && account ? (
                <>
                  <span className="connection-status"><i />Connected</span>
                  <strong>@{account.username}</strong>
                  {account.display_name && <small>{account.display_name}</small>}
                </>
              ) : account ? (
                <>
                  <span className="connection-status connection-status--setup"><i />Reconnect required</span>
                  <strong>@{account.username}</strong>
                  <small>The saved login expired and can no longer publish.</small>
                </>
              ) : instagram?.configured ? (
                <>
                  <span className="connection-status connection-status--idle"><i />Not connected</span>
                  <strong>Authorize your account</strong>
                  <small>Clip Farm will request publishing access.</small>
                </>
              ) : (
                <>
                  <span className="connection-status connection-status--setup"><i />Setup required</span>
                  <strong>Add Meta credentials</strong>
                  <small>Complete the server configuration before logging in.</small>
                </>
              )}
            </div>

            <div className="connected-app__action">
              {connected && account ? (
                <button className="disconnect-button" type="button" onClick={() => setConfirmDisconnect(true)}>
                  <Unplug size={16} /> Disconnect
                </button>
              ) : instagram?.configured ? (
                <a className="connect-button" href={api.platformConnectUrl('instagram')}>
                  Connect Instagram <ArrowUpRight size={17} />
                </a>
              ) : (
                <button className="connect-button" type="button" disabled>
                  Connect Instagram <ArrowUpRight size={17} />
                </button>
              )}
            </div>

            {account && (
              <dl className="connected-app__details">
                <div><dt>Access</dt><dd><ShieldCheck size={14} /> Content publishing</dd></div>
                <div><dt>Connected</dt><dd>{formatDate(account.connected_at)}</dd></div>
                <div><dt>Valid until</dt><dd>{formatDate(account.token_expires_at)}</dd></div>
                <div><dt>Storage</dt><dd><LockKeyhole size={14} /> Encrypted</dd></div>
              </dl>
            )}

            {!account && !instagram?.configured && (
              <div className="connection-setup">
                <div className="connection-setup__copy">
                  <KeyRound size={19} />
                  <div>
                    <strong>Server configuration needed</strong>
                    <p>Create a Meta Business app with Instagram Login, then add these values to <code>apps/api/.env</code>.</p>
                  </div>
                </div>
                <div className="env-key-list">
                  {instagram?.missing_configuration.map((name) => <code key={name}>{name}</code>)}
                </div>
              </div>
            )}

            {confirmDisconnect && connected && account && (
              <div className="disconnect-confirm" role="alert">
                <div>
                  <strong>Disconnect @{account.username}?</strong>
                  <span>The encrypted token will be removed from Clip Farm.</span>
                </div>
                <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnect.isPending}>Keep connected</button>
                <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                  {disconnect.isPending ? <LoaderCircle className="spin" size={15} /> : <Unplug size={15} />}
                  Disconnect
                </button>
              </div>
            )}
          </article>
        )}
      </section>

      <section className="connection-footnotes" aria-label="Connection security and next step">
        <div><ShieldCheck size={20} /><span><strong>Private by design</strong>Tokens are encrypted at rest and never returned to the browser.</span></div>
        <div><Link2 size={20} /><span><strong>Publishing ready</strong>Complete a render, then use Post to Instagram from the editor.</span></div>
      </section>
    </main>
  )
}
