import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'
import { Alert, Button } from '../../ui/index.jsx'
import { useAuth } from '../../auth.jsx'
import { AuthLayout, CardBrand, EMAIL_RE, GoogleSignIn, PasswordField, TextField, postForm } from './components/AuthKit.jsx'

/**
 * Admin sign in (no reference image — same split layout as the recruiter
 * login). POST /api/auth/login (form-data email/password); only role=admin
 * accounts are accepted → loginAdmin → /admin/dashboard.
 */
export default function AdminLogin() {
  const { loginAdmin, adminToken } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (adminToken) navigate('/admin/dashboard', { replace: true }) }, [adminToken, navigate])

  const submit = async (ev) => {
    ev.preventDefault()
    const e = {}
    // Admins may sign in with an email or a plain admin ID (ADMIN_EMAIL can be e.g. "trilog").
    const id = email.trim()
    if (!id || (id.includes('@') && !EMAIL_RE.test(id))) e.email = 'Enter your admin ID or email'
    if (!password) e.password = 'Enter your password'
    setErrors(e)
    if (Object.keys(e).length) return
    setError(null)
    setLoading(true)
    try {
      const data = await postForm('/api/auth/login', { email: email.trim().toLowerCase(), password })
      if (data.role !== 'admin') {
        setError('This account does not have admin access.')
        return
      }
      loginAdmin(data.access_token, data.email)
      navigate('/admin/dashboard')
    } catch (x) {
      setError(x.status === 401 ? 'Incorrect admin ID or password.' : x.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout image="/assets/images/crops/login-recruiter.jpg" imageAlt="CoreLink platform team at work">
      <CardBrand />
      <h1 className="cl-row" style={{ gap: 10 }}><ShieldCheck size={26} color="var(--cl-blue)" aria-hidden="true" /> Admin Login</h1>
      <p className="pub-auth-sub">Platform administration for CoreLink staff.</p>
      <form className="pub-form" onSubmit={submit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField id="ad-email" label="Admin ID or email" icon={Mail} type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={email} onChange={(x) => setEmail(x.target.value)} error={errors.email} autoFocus />
        <PasswordField id="ad-password" autoComplete="current-password" value={password} onChange={(x) => setPassword(x.target.value)} error={errors.password} />
        <p className="pub-note">Forgot your password? Another admin can send you a reset link from User Management.</p>
        <Button type="submit" block className="pub-submit" loading={loading} iconRight={ArrowRight}>Sign In</Button>
      </form>
      <GoogleSignIn role="admin" onSuccess={(data) => { loginAdmin(data.access_token, data.email); navigate('/admin/dashboard') }} onError={(msg) => setError(msg)} />
      <p className="pub-roles"><Link to="/candidate/login">Student sign in</Link><span aria-hidden="true">·</span><Link to="/recruiter/login">Recruiter sign in</Link><span aria-hidden="true">·</span><Link to="/">Home</Link></p>
    </AuthLayout>
  )
}
