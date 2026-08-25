import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Onboarding({ type }) {
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState(0)
  const navigate = useNavigate()

  const storageKey = `corelink_onboarding_${type}_completed`

  useEffect(() => {
    const isCompleted = localStorage.getItem(storageKey)
    if (!isCompleted) {
      setIsOpen(true)
    }
  }, [storageKey])

  if (!isOpen) return null

  const handleSkip = () => {
    localStorage.setItem(storageKey, 'true')
    setIsOpen(false)
  }

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      handleSkip()
      if (type === 'candidate') {
        navigate('/candidate/profile')
      }
    }
  }

  const candidateSteps = [
    { title: 'Welcome to CoreLink', text: 'Connecting you with the right opportunities.' },
    { title: 'Step 1: Build your profile', text: 'Upload your resume and add your experience to get discovered.' },
    { title: 'Step 2: Discover matching jobs', text: 'Our intelligent ATS scoring finds the best roles for your skills.' },
    { title: 'Step 3: Track your progress', text: 'Follow your applications from submission to hire.' }
  ]

  const recruiterSteps = [
    { title: 'Welcome to CoreLink', text: 'Find your next great hire, faster than ever.' },
    { title: 'Step 1: Verify your identity', text: 'We verify all recruiter accounts to keep the platform secure.' },
    { title: 'Step 2: Create a job', text: 'Publish opportunities and specify required skills.' },
    { title: 'Step 3: Review matches', text: 'Instantly view Candidate ATS scores and application timelines.' }
  ]

  const steps = type === 'candidate' ? candidateSteps : recruiterSteps

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h2>{steps[step].title}</h2>
        </div>
        <div style={bodyStyle}>
          <p>{steps[step].text}</p>
        </div>
        
        <div style={progressStyle}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%', 
              backgroundColor: i === step ? 'var(--primary)' : 'var(--border)',
              margin: '0 4px'
            }} />
          ))}
        </div>

        <div style={footerStyle}>
          <button className="btn btn-ghost" onClick={handleSkip}>Skip</button>
          <button className="btn btn-primary" onClick={handleNext}>
            {step === steps.length - 1 ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  backdropFilter: 'blur(4px)'
}

const modalStyle = {
  backgroundColor: 'var(--surface)',
  borderRadius: '12px',
  width: '100%',
  maxWidth: '480px',
  padding: '24px',
  boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
  border: '1px solid var(--border)',
  textAlign: 'center'
}

const headerStyle = {
  marginBottom: '16px',
  color: 'var(--text-primary)'
}

const bodyStyle = {
  marginBottom: '24px',
  color: 'var(--text-secondary)',
  fontSize: '16px',
  lineHeight: 1.5
}

const progressStyle = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: '24px'
}

const footerStyle = {
  display: 'flex',
  justifyContent: 'space-between'
}
