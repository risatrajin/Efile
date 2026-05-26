"""Shared pytest fixtures and helpers.

Centralises:
  • The test password (read from env so it is never hard-coded). Falls back
    to a clearly-marked dev sentinel only when running locally — production
    test runs MUST set ``CT_TEST_PASSWORD``.
  • The backend URL & a properly-configured ``requests`` session that does
    NOT disable TLS verification. The previous tests used ``verify=False``
    everywhere which silenced legitimate certificate errors; we now trust
    the system CA bundle by default. Set ``CT_TEST_VERIFY=false`` only in
    truly broken local environments.
"""
import os
import pytest
import requests


def _get_test_password() -> str:
    pw = os.environ.get("CT_TEST_PASSWORD")
    if pw:
        return pw
    # Local-dev convenience only. Real CI / prod test runs must override.
    return "CloudTax2026!"


def _verify_ssl() -> bool:
    return os.environ.get("CT_TEST_VERIFY", "true").lower() not in ("0", "false", "no")


TEST_PASSWORD: str = _get_test_password()
TEST_BACKEND_URL: str = os.environ["REACT_APP_BACKEND_URL"]
VERIFY_SSL: bool = _verify_ssl()


@pytest.fixture(scope="session")
def backend_url() -> str:
    return TEST_BACKEND_URL


@pytest.fixture(scope="session")
def test_password() -> str:
    return TEST_PASSWORD


@pytest.fixture(scope="session")
def http() -> requests.Session:
    """A ``requests.Session`` with TLS verification on by default."""
    s = requests.Session()
    s.verify = VERIFY_SSL
    return s
