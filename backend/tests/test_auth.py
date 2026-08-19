"""
Tests for auth.py (password hashing + JWT). These need passlib and python-jose
installed (they're in requirements.txt) to run - unlike test_scoring.py, this
couldn't be hand-verified in the sandbox this project was built in, since those
packages require network access to install. Run `pytest` locally to confirm.
"""
import sys
import os
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app.auth import hash_password, verify_password, create_access_token, decode_access_token
from fastapi import HTTPException
from datetime import timedelta


def test_password_hash_and_verify_roundtrip():
    hashed = hash_password("correct-horse-battery-staple")
    assert verify_password("correct-horse-battery-staple", hashed)


def test_password_verify_rejects_wrong_password():
    hashed = hash_password("correct-horse-battery-staple")
    assert not verify_password("wrong-password", hashed)


def test_password_hash_is_not_plaintext():
    hashed = hash_password("mypassword")
    assert hashed != "mypassword"


def test_token_roundtrip_returns_correct_username():
    token = create_access_token("alice")
    username = decode_access_token(token)
    assert username == "alice"


def test_expired_token_is_rejected():
    token = create_access_token("bob", expires_delta=timedelta(seconds=-1))
    with pytest.raises(HTTPException) as exc_info:
        decode_access_token(token)
    assert exc_info.value.status_code == 401


def test_garbage_token_is_rejected():
    with pytest.raises(HTTPException):
        decode_access_token("not-a-real-token")
