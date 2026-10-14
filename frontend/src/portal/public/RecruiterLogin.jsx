import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowRight, ArrowLeft, Mail, KeyRound } from 'lucide-react'
import { Alert, Button } from '../../ui/index.jsx'
import { useAuth } from '../../auth.jsx'
import RecruiterAccessRequest from '../../components/RecruiterAccessRequest.jsx'
import { AuthLayout, CardBrand, EMAIL_RE, GoogleSignIn, PasswordField, TextField, postForm } from './components/AuthKit.jsx'

const IMG = '/assets/images/crops/login-recruiter.jpg'
const COPY = {
  login: ['Recruiter Login', 'Access your account and start hiring top engineering talent.'],
  forgot: ['Reset your password', 'Enter your work email and we will send you a reset code.'],
  reset: ['Choose a new password', 'Enter the reset code from your email and pick a new password.'],
}

/**
 * Page 03 — recruiter sign in. POST /api/recruiter/auth/login (form-data
 * username/password) → loginRecruiter → /recruiter/dashboard. Admin accounts
 * signing in here are sent to the admin portal. "Contact Us" opens the
 * recruiter access request form (POST /api/recruiter-requests with live
 * /api/recruiter-requests/validate checks).
 */
export default function RecruiterLogin() {
  const { loginRecruiter, loginAdmin, recruiterToken } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const initial = new URLSearchParams(location.search).get('mode')
  const [mode, setMode] = useState(['request', 'forgot'].includes(initial) ? initial : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [devCode, setDevCode] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (recruiterToken) navigate('/recruiter/dashboard', { replace: true }) }, [recruiterToken, navigate])

  const go = (m) => {
    setMode(m); setErrors({}); setError(null); setNotice(null); setPassword(''); setConfirm('')
    navigate({ search: m === 'login' ? '' : `?mode=${m}` }, { replace: true })
  }

  const validate = () => {
    const e = {}
    if (!email.trim()) e.email = 'Enter your work email'
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address'
    if (mode === 'login' && !password) e.password = 'Enter your password'
    if (mode === 'reset') {
      if (!code.trim()) e.code = 'Enter the reset code from your email'
      if (password.length < 8) e.password = 'Password must be at least 8 characters'
      else if (confirm !== password) e.confirm = 'Passwords do not match'
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  const submit = async (ev) => {
    ev.preventDefault()
    if (!validate()) return
    setError(null)
    setNotice(null)
    setLoading(true)
    const addr = email.trim().toLowerCase()
    try {
      if (mode === 'login') {
        const data = await postForm('/api/recruiter/auth/login', { username: addr, password })
        if (data.role === 'admin') {
          loginAdmin(data.access_token, data.email || addr)
          navigate('/admin/dashboard')
        } else if (data.role === 'recruiter') {
          loginRecruiter(data.access_token, data.email || data.username || addr)
          navigate('/recruiter/dashboard')
        } else {
          setError('This is a student account — use the student sign in page.')
        }
      } else if (mode === 'forgot') {
        const data = await postForm('/api/auth/password-reset/request', { email: addr })
        const tok = data?.dev_only?.reset_token
        go('reset')
        setDevCode(tok || null)
        if (tok) setCode(tok)
        setNotice(`If a recruiter account exists for ${addr}, a reset code is on its way. It expires in 15 minutes.`)
      } else {
        await postForm('/api/auth/password-reset/confirm', { email: addr, token: code.trim(), new_password: password })
        go('login')
        setDevCode(null)
        setCode('')
        setNotice('Password updated — sign in with your new password.')
      }
    } catch (e) {
      setError(e.status === 401 ? 'Incorrect email or password.' : e.message)
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'request') {
    return (
      <AuthLayout image={IMG} imageAlt="Recruiter reviewing engineering candidate profiles" wide>
        <CardBrand />
        <button type="button" className="pub-linkbtn pub-back" style={{ marginBottom: 14 }} onClick={() => go('login')}><ArrowLeft size={15} /> Back to recruiter sign in</button>
        <RecruiterAccessRequest onSwitchToLogin={() => go('login')} />
      </AuthLayout>
    )
  }

  const [title, sub] = COPY[mode]
  return (
    <AuthLayout image={IMG} imageAlt="Recruiter reviewing engineering candidate profiles">
      {(info) => (
        <>
          <CardBrand />
          <h1>{title}</h1>
          <p className="pub-auth-sub">{sub}</p>
          <form className="pub-form" onSubmit={submit} noValidate>
            {notice && <Alert tone="success">{notice}</Alert>}
            {error && <Alert tone="error">{error}</Alert>}
            <TextField id="rc-email" label="Email address" icon={Mail} type="email" autoComplete="username" inputMode="email" value={email}
              onChange={(e) => setEmail(e.target.value)} error={errors.email} disabled={mode === 'reset'} autoFocus />
            {mode === 'reset' && <TextField id="rc-code" label="Reset code" icon={KeyRound} value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} autoComplete="one-time-code" />}
            {devCode && mode === 'reset' && <div className="pub-dev">Development mode — email delivery is off, so the reset code was filled in for you.</div>}
            {mode !== 'forgot' && (
              <PasswordField id="rc-password" label={mode === 'reset' ? 'New password (min. 8 characters)' : 'Password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} strength={mode === 'reset'} />
            )}
            {mode === 'reset' && <PasswordField id="rc-confirm" label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />}
            {mode === 'login' && <div className="pub-row-end"><button type="button" className="pub-linkbtn" onClick={() => go('forgot')}>Forgot password?</button></div>}
            <Button type="submit" block className="pub-submit" loading={loading} iconRight={ArrowRight}>
              {mode === 'login' ? 'Sign In' : mode === 'forgot' ? 'Send Reset Code' : 'Update Password'}
            </Button>
          </form>
          {mode === 'login' && (
            <GoogleSignIn role="recruiter"
              onSuccess={(data) => {
                if (data.role === 'admin') { loginAdmin(data.access_token, data.email); navigate('/admin/dashboard') }
                else { loginRecruiter(data.access_token, data.email || data.username); navigate('/recruiter/dashboard') }
              }}
              onError={(msg) => setError(msg)} />
          )}
          {mode === 'login' && <p className="pub-switch">Don’t have an account?<button type="button" className="pub-linkbtn" onClick={() => go('request')}>Contact Us</button></p>}
          {mode !== 'login' && (
            <>
              <p className="pub-switch">
                {mode === 'reset' && <><button type="button" className="pub-linkbtn" onClick={() => go('forgot')}>Resend code</button><span aria-hidden="true"> · </span></>}
                <button type="button" className="pub-linkbtn pub-back" onClick={() => go('login')}><ArrowLeft size={15} /> Back to sign in</button>
              </p>
              <p className="pub-note" style={{ textAlign: 'center', marginTop: 12 }}>
                Can’t access your work email? Ask your company’s CoreLink admin{info?.support_email ? <> or write to <a href={`mailto:${info.support_email}`}>{info.support_email}</a></> : ''}.
              </p>
            </>
          )}
          <p className="pub-roles"><Link to="/candidate/login">Student sign in</Link><span aria-hidden="true">·</span><Link to="/">Back to home</Link><span aria-hidden="true">·</span><Link to="/privacy">Privacy</Link></p>
        </>
      )}
    </AuthLayout>
  )
}
