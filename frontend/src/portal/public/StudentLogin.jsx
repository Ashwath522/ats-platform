import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowRight, ArrowLeft, Mail, KeyRound } from 'lucide-react'
import { Alert, Button } from '../../ui/index.jsx'
import { useAuth } from '../../auth.jsx'
import { AuthLayout, CardBrand, EMAIL_RE, PasswordField, ProviderButtons, TextField, postForm, useProviders } from './components/AuthKit.jsx'
import { useLoginSuccess } from '../../ui/LoginSuccess.jsx'

const LAST = 'cl_last_signin_method'
const lastMethod = () => { try { return localStorage.getItem(LAST) } catch { return null } }
const rememberMethod = (m) => { try { localStorage.setItem(LAST, m) } catch { /* ignore */ } }

const IMG = '/assets/images/crops/login-student.jpg'
const COPY = {
  login: ['Student Login', 'Access your account and continue your engineering journey.'],
  signup: ['Create your account', 'Join CoreLink to showcase your skills and get matched with core engineering roles.'],
  forgot: ['Reset your password', 'Enter the email you signed up with and we will send you a reset code.'],
  reset: ['Choose a new password', 'Enter the reset code from your email and pick a new password.'],
}

/**
 * Page 02 — student sign in / sign up / forgot password.
 * Contract kept from the old CandidateLogin: POST /api/candidate/auth/login (or
 * /register) as form-data {username, password} → loginCandidate(token, username)
 * → /candidate/feed.
 */
export default function StudentLogin() {
  const { loginCandidate, candidateToken } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const initial = new URLSearchParams(location.search).get('mode')
  const [mode, setMode] = useState(['signup', 'forgot'].includes(initial) ? initial : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(() => location.state?.authError || null)
  const [notice, setNotice] = useState(null)
  const [devCode, setDevCode] = useState(null)
  const [loading, setLoading] = useState(false)
  const providers = useProviders()
  const [emailChosen, setEmailChosen] = useState(() => lastMethod() === 'email')
  const [overlay, celebrate] = useLoginSuccess()

  useEffect(() => { if (candidateToken && !overlay) navigate('/candidate/feed', { replace: true }) }, [candidateToken, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Google / LinkedIn / Email chooser first; the email form after "Continue with Email".
  const anyProvider = providers.google !== false || providers.linkedin !== false
  const showChooser = (mode === 'login' || mode === 'signup') && !emailChosen && anyProvider
  const welcome = (data, method, created) => {
    rememberMethod(method)
    celebrate(data.username, () => { loginCandidate(data.access_token, data.username); navigate('/candidate/feed') },
      created ? 'Account created · setting up your space' : undefined)
  }

  const go = (m) => { setMode(m); setErrors({}); setError(null); setNotice(null); setPassword(''); setConfirm('') }

  const validate = () => {
    const e = {}
    if (!email.trim()) e.email = 'Enter your email address'
    else if (mode !== 'login' && !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address'
    if (mode === 'login' && !password) e.password = 'Enter your password'
    if (mode === 'signup' || mode === 'reset') {
      if (password.length < 8) e.password = 'Password must be at least 8 characters'
      else if (confirm !== password) e.confirm = 'Passwords do not match'
    }
    if (mode === 'reset' && !code.trim()) e.code = 'Enter the reset code from your email'
    setErrors(e)
    return !Object.keys(e).length
  }

  const submit = async (ev) => {
    ev.preventDefault()
    if (!validate()) return
    setError(null)
    setNotice(null)
    setLoading(true)
    const username = email.trim()
    try {
      if (mode === 'login' || mode === 'signup') {
        const data = await postForm(mode === 'login' ? '/api/candidate/auth/login' : '/api/candidate/auth/register', { username, password })
        welcome(data, 'email', mode === 'signup')
      } else if (mode === 'forgot') {
        const data = await postForm('/api/candidate/auth/password-reset/request', { username })
        setDevCode(data?.dev_only?.reset_token || null)
        if (data?.dev_only?.reset_token) setCode(data.dev_only.reset_token)
        go('reset')
        setNotice(`If an account exists for ${username}, a reset code is on its way. It expires in 15 minutes.`)
      } else {
        await postForm('/api/candidate/auth/password-reset/confirm', { username, token: code.trim(), new_password: password })
        go('login')
        setDevCode(null)
        setCode('')
        setNotice('Password updated — sign in with your new password.')
      }
    } catch (e) {
      setError(e.status === 409 ? 'An account with this email already exists. Sign in instead.' : e.message)
    } finally {
      setLoading(false)
    }
  }

  const [title, sub] = COPY[mode]
  return (
    <AuthLayout image={IMG} imageAlt="Engineering students designing and testing a chip on a lab bench">
      {(info) => (
        <>
          <CardBrand />
          <h1>{title}</h1>
          <p className="pub-auth-sub">{sub}</p>
          {showChooser ? (
            <div className="pub-reveal" key="chooser">
              {notice && <Alert tone="success">{notice}</Alert>}
              {error && <div style={{ marginBottom: 14 }}><Alert tone="error">{error}</Alert></div>}
              <ProviderButtons role="candidate" providers={providers} googleText={mode === 'signup' ? 'signup_with' : 'continue_with'}
                emailLabel={mode === 'signup' ? 'Sign up with Email' : 'Continue with Email'}
                onEmail={() => { setEmailChosen(true); setError(null) }}
                onSuccess={(data) => welcome(data, data.method || 'google', data.created)}
                onError={(msg) => setError(msg)} />
              <p className="pub-chooser-note">By continuing you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</p>
            </div>
          ) : (
          <form className="pub-form pub-reveal" key="form" onSubmit={submit} noValidate>
            {(mode === 'login' || mode === 'signup') && anyProvider && (
              <button type="button" className="pub-back-top" onClick={() => { setEmailChosen(false); setErrors({}); setError(null) }}><ArrowLeft size={15} /> Other ways to {mode === 'signup' ? 'sign up' : 'sign in'}</button>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            {error && <Alert tone="error">{error}</Alert>}
            <TextField id="st-email" label="Email address" icon={Mail} type="email" autoComplete="email" inputMode="email" value={email}
              onChange={(e) => setEmail(e.target.value)} error={errors.email} disabled={mode === 'reset'} autoFocus />
            {mode === 'reset' && (
              <TextField id="st-code" label="Reset code" icon={KeyRound} value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} autoComplete="one-time-code" />
            )}
            {devCode && mode === 'reset' && <div className="pub-dev">Development mode — email delivery is off, so the reset code was filled in for you.</div>}
            {mode !== 'forgot' && (
              <PasswordField id="st-password" label={mode === 'login' ? 'Password' : mode === 'reset' ? 'New password (min. 8 characters)' : 'Create password (min. 8 characters)'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)}
                error={errors.password} strength={mode !== 'login'} />
            )}
            {(mode === 'signup' || mode === 'reset') && (
              <PasswordField id="st-confirm" label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
            )}
            {mode === 'login' && (
              <div className="pub-row-end"><button type="button" className="pub-linkbtn" onClick={() => go('forgot')}>Forgot password?</button></div>
            )}
            <Button type="submit" block className="pub-submit" loading={loading} iconRight={ArrowRight}>
              {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Code' : 'Update Password'}
            </Button>
          </form>
          )}
          {mode === 'login' && <p className="pub-switch">Don’t have an account?<button type="button" className="pub-linkbtn" onClick={() => go('signup')}>Sign Up</button></p>}
          {mode === 'signup' && <p className="pub-switch">Already have an account?<button type="button" className="pub-linkbtn" onClick={() => go('login')}>Sign In</button></p>}
          {(mode === 'forgot' || mode === 'reset') && (
            <p className="pub-switch">
              {mode === 'reset' && <><button type="button" className="pub-linkbtn" onClick={() => go('forgot')}>Resend code</button><span aria-hidden="true"> · </span></>}
              <button type="button" className="pub-linkbtn pub-back" onClick={() => go('login')}><ArrowLeft size={15} /> Back to sign in</button>
            </p>
          )}
          {mode === 'forgot' && info?.support_email && <p className="pub-note" style={{ textAlign: 'center', marginTop: 12 }}>No email on file? Write to <a href={`mailto:${info.support_email}`}>{info.support_email}</a>.</p>}
          {overlay}
          <p className="pub-roles"><Link to="/recruiter/login">Recruiter sign in</Link><span aria-hidden="true">·</span><Link to="/">Back to home</Link><span aria-hidden="true">·</span><Link to="/privacy">Privacy</Link></p>
        </>
      )}
    </AuthLayout>
  )
}
