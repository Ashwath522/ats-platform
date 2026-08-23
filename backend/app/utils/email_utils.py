import os
import httpx
import logging


def send_resend_email(to: str, subject: str, html: str) -> None:
    """Send an email via Resend.

    Reads the API key from the ``RESEND_API_KEY`` environment variable.
    Raises ``RuntimeError`` if the key is missing.
    """
    api_key = os.getenv('RESEND_API_KEY')
    if not api_key:
        raise RuntimeError('RESEND_API_KEY environment variable not set')

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    payload = {
        'from': 'no-reply@corelink.com',
        'to': to,
        'subject': subject,
        'html': html,
    }
    try:
        response = httpx.post('https://api.resend.com/emails', json=payload, headers=headers, timeout=10)
        response.raise_for_status()
    except Exception as e:
        logging.error(f'Failed to send email via Resend: {e}')
        raise


def send_welcome_email(to: str, name: str) -> None:
    """Convenience wrapper for the welcome email sent after profile creation."""
    subject = 'Welcome to Corelink – Your ATS Platform'
    html = f'''<p>Hi {name},</p>
<p>Welcome to Corelink! Your candidate profile has been created. You can now upload your resume, explore job listings, and use our ATS scoring to improve your applications.</p>
<p>Best regards,<br/>The Corelink Team</p>'''
    send_resend_email(to, subject, html)
